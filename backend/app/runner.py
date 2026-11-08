"""Run executor: drives one Game in real time with LLM (or scripted) agents, persists and broadcasts it.

Only the tick loop touches the DB (one session per tick). Agent tasks work on the in-memory game and append
Decision rows / cost deltas to lists that the tick loop flushes.
"""

import asyncio
import logging
import time
from datetime import UTC, datetime

import anthropic
from sqlalchemy import func, update

from app import hub, settings_store
from app.agents import llm
from app.agents.prompts import LEADER_LINES, system_prompt
from app.db import SessionLocal
from app.game.engine import Game, GameConfig
from app.game.layouts import make_layout
from app.game.scripted import scripted_decision
from app.measure import run as measure
from app.models import ApiKey, Decision as DecisionRow, Experiment, Run, RunEvent
from app.security import decrypt

log = logging.getLogger(__name__)

TICK_MS = 100  # real-time loop period
REFRESH_S = 1.0  # how often the tick loop re-reads stop conditions (stop flag, spent, key) from the DB
END_WAIT_S = 30  # after a natural end, wait this long for in-flight calls so their cost is counted
LEADER_GROUPS = ("free", "directive", "nondirective")
DEV_BUDGET = [6, 6, 6, 6]


RETRY_LATER_MS = 15_000  # after a rate limit / overload that outlived the SDK's own retries
TRANSIENT_ERRORS = ("RateLimitError", "OverloadedError", "InternalServerError", "APIConnectionError",
                    "APITimeoutError", "ServiceUnavailableError")


def _is_out_of_credit(error: str | None) -> bool:
    return bool(error) and error.startswith("BadRequestError") and "credit balance" in error.lower()


def _is_transient(error: str | None) -> bool:
    return bool(error) and error.startswith(TRANSIENT_ERRORS)


class _Run:
    def __init__(self, run: Run, exp: Experiment | None, mode: str, key: str | None):
        self.run_id, self.exp_id, self.mode = run.id, run.experiment_id, mode
        cfg = exp.config if exp else {}
        s = (cfg.get("settings") or {}) if exp else settings_store.DEFAULTS
        self.model, self.effort = cfg.get("model"), s.get("effort", "low")
        self.call_limit, self.min_influence = s.get("call_limit", 45), s.get("min_influence", 0.5)
        # Min gap between one agent's calls: stops chat storms (every message wakes everyone) from burning
        # calls and the key's tokens-per-minute limit. Scripted dev runs don't need it.
        self.min_gap_ms = int(s.get("min_call_gap_s", 3) * 1000) if mode == "llm" else 0
        self.seed = run.seed if run.seed is not None else run.layout_no
        layout = make_layout(run.layout_no, cfg.get("budget", DEV_BUDGET), self.seed)
        leader = layout.leader if run.group in LEADER_GROUPS else None
        leader_line = ((cfg.get("leader_prompts") or {}).get(run.group) or LEADER_LINES.get(run.group)) if leader else None
        gcfg = GameConfig(
            cell_ms=int(s["cell_seconds"] * 1000), flip_ms=int(s["flip_seconds"] * 1000),
            time_limit_ms=int(s["time_limit_s"] * 1000), heartbeat_ms=int(s["heartbeat_s"] * 1000),
            know_all_goals=bool(cfg.get("know_all_goals")), leader=leader, leader_style=run.group if leader else None,
        )
        self.game = Game(layout, gcfg, group=run.group, seed=self.seed)
        self.systems = {
            name: system_prompt(name, layout.goals[name], layout.budgets[name], gcfg.know_all_goals, layout.goals,
                                leader_line if name == leader else None, gcfg, layout.zone)
            for name, _ in layout.agents
        } if mode == "llm" else {}
        self.client = llm.make_client(key) if key else None
        self.user_id = exp.user_id if exp else None
        self.t0 = 0.0
        # agent bookkeeping
        self.inflight: dict[str, asyncio.Task] = {}
        self.n = dict.fromkeys(self.game.agents, 0)
        self.calls = dict.fromkeys(self.game.agents, 0)
        self.next_ok = dict.fromkeys(self.game.agents, 0)  # game ms before which the agent is not asked again
        self.rate_limited = 0
        self.calls_in_flight = 0
        self.last_call_cost = 0.0
        # pending writes (flushed by the tick loop) and full log for measurement
        self.decisions: list[dict] = []
        self.pending_decisions: list[dict] = []
        self.pending_cost = 0.0
        self.run_cost = 0.0
        # stop conditions, refreshed from the DB every REFRESH_S
        self.exp_stop: str | None = None
        self.spent, self.cap = 0.0, float("inf")
        self.key_exists = True
        self.fatal: str | None = None
        self.stop_reason: str | None = None  # set once the game is ended by a stop

    def now(self) -> int:
        return int((time.monotonic() - self.t0) * 1000)

    # ---- stop conditions --------------------------------------------------------------

    def check_stop(self) -> str | None:
        if self.fatal:
            return self.fatal
        if self.exp_id is None:
            return None
        if self.exp_stop:
            return self.exp_stop
        if not self.key_exists:
            return "key_deleted"
        # ponytail: other runs' costs are seen only after the next refresh, so the cap can overshoot by
        # about one refresh worth of calls across parallel runs; that is the accepted slack (plan, milestone 6).
        if self.spent + self.pending_cost + self.calls_in_flight * self.last_call_cost >= self.cap:
            return "cap_reached"
        return None

    async def refresh(self, db):
        exp = await db.get(Experiment, self.exp_id, populate_existing=True)
        if exp is None:
            self.exp_stop = "user_stopped"
            return
        self.exp_stop = (exp.stop_reason or "user_stopped") if exp.stop_requested else None
        self.spent, self.cap = exp.spent_usd, exp.cap_usd
        if self.mode == "llm":
            self.key_exists = await db.get(ApiKey, self.user_id, populate_existing=True) is not None

    # ---- persistence ------------------------------------------------------------------

    async def flush(self, refresh: bool = False):
        events = self.game.drain_events()
        decisions, self.pending_decisions = self.pending_decisions, []
        cost, self.pending_cost = self.pending_cost, 0.0
        if not (events or decisions or cost or refresh):
            return
        async with SessionLocal() as db:
            db.add_all(RunEvent(run_id=self.run_id, seq=e["seq"], t_ms=e["t"], type=e["type"], data=e["data"])
                       for e in events)
            db.add_all(DecisionRow(run_id=self.run_id, **d) for d in decisions)
            if cost:
                await db.execute(update(Run).where(Run.id == self.run_id).values(cost_usd=Run.cost_usd + cost))
                await db.execute(update(Experiment).where(Experiment.id == self.exp_id)
                                 .values(spent_usd=Experiment.spent_usd + cost))
            await db.commit()
            if refresh and self.exp_id is not None:
                await self.refresh(db)
        for e in events:  # after commit: a WS client that misses the publish finds the event in the DB
            hub.publish(self.run_id, e)

    async def request_stop(self, reason: str):
        """Stop found by this run (cap, key, fatal error): flag the experiment so the other runs stop too."""
        if self.exp_id is None or self.exp_stop:
            return
        async with SessionLocal() as db:
            await db.execute(update(Experiment).where(Experiment.id == self.exp_id).values(
                stop_requested=True, stop_reason=func.coalesce(Experiment.stop_reason, reason)))
            await db.commit()

    # ---- agents -----------------------------------------------------------------------

    def spawn_calls(self):
        game, now = self.game, self.now()
        for agent in game.agents:
            if game.ended or agent in self.inflight or now < self.next_ok[agent] or not game.wants_call(agent, now):
                continue
            triggers = game.take_triggers(agent)
            self.inflight[agent] = asyncio.create_task(self.agent_turn(agent, triggers))

    def reap(self):
        """Drop finished agent tasks; re-raise an unexpected error from one of them."""
        for agent, task in list(self.inflight.items()):
            if task.done():
                del self.inflight[agent]
                if not task.cancelled() and task.exception():
                    raise task.exception()

    async def agent_turn(self, agent: str, triggers: list[str]):
        game = self.game
        for attempt in (1, 2):
            if game.ended or self.check_stop():
                return
            req, res = {}, None
            if self.mode == "llm":
                req = llm.build_request(self.model, self.systems[agent], game.observation(agent), triggers,
                                        game.chat, game.agents[agent]["notes"])
                self.calls_in_flight += 1
                try:
                    res = await llm.call_decision(self.client, req, self.effort)
                except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
                    self.fatal = "invalid_key"
                    return
                finally:
                    self.calls_in_flight -= 1
                    self.next_ok[agent] = self.now() + self.min_gap_ms
                if _is_out_of_credit(res.error):
                    self.fatal = "out_of_credit"
                    return
                if res.decision is None and _is_transient(res.error):
                    # Not the agent's fault: keep its news for the next call and ask again later.
                    self.rate_limited += 1
                    game.agents[agent]["triggers"][:0] = [t for t in triggers if not t.startswith("Your last answer")]
                    self.next_ok[agent] = self.now() + RETRY_LATER_MS
                    return
                self.calls[agent] += 1
                self.last_call_cost = res.cost_usd
                self.pending_cost += res.cost_usd
                self.run_cost += res.cost_usd
                dec, error = res.decision, res.error
            else:
                kind, chair, cell, msg = scripted_decision(game, agent)
                dec = llm.Decision(action=kind, chair=chair, x=cell[0] if cell else None,
                                   y=cell[1] if cell else None, message=msg)
                error = None

            game.tick(self.now())  # apply the answer at the current moment, not at the last tick
            self.n[agent] += 1
            cell = [dec.x, dec.y] if dec and dec.x is not None and dec.y is not None else None
            reason = error
            if game.ended:
                outcome = "game_over"
            elif dec is None:
                outcome = "invalid"
            else:
                was_idle = not game.is_busy(agent)
                outcome, reason = game.decide(agent, dec.action, dec.chair, cell)
                if outcome != "invalid":
                    if dec.message:
                        game.say(agent, dec.message)
                    if dec.notes is not None:
                        game.set_notes(agent, dec.notes)
                    if outcome == "ok" and dec.action in ("wait", "continue") and was_idle:
                        outcome = "skipped_chose"
            retry = outcome == "invalid" and attempt == 1
            if outcome == "invalid" and attempt == 2:
                outcome = "skipped_invalid"
            if not retry and outcome != "game_over":
                # a skipped answer counts as doing nothing (so all_waiting can still end a stuck game)
                game.record_decision(agent, "continue" if outcome == "skipped_invalid" else dec.action, game.t)

            row = {
                "agent": agent, "seq": self.n[agent], "t_ms": game.t, "trigger": list(triggers), "request": req,
                "response": dec.model_dump() if dec else {"error": error},
                "action": {"kind": dec.action, "chair": dec.chair, "cell": cell} if dec else None,
                "outcome": outcome,
                "input_tokens": res.input_tokens if res else 0, "output_tokens": res.output_tokens if res else 0,
                "cost_usd": res.cost_usd if res else 0.0,
            }
            self.decisions.append(row)
            self.pending_decisions.append(row)
            game.emit("decision", {"agent": agent, "n": self.n[agent], "kind": dec.action if dec else None,
                                   "chair": dec.chair if dec else None, "cell": cell, "outcome": outcome,
                                   "reason": reason})
            if res is not None:
                game.emit("cost", {"usd": round(self.run_cost, 6)})
                if self.calls[agent] >= self.call_limit:
                    game.end("call_limit")
            if not retry:
                return
            why = (reason or "unknown error")[:300].rstrip(".")
            triggers = triggers + [f"Your last answer could not be used: {why}."]

    # ---- main loop --------------------------------------------------------------------

    async def play(self, tick_ms: int):
        game = self.game
        self.t0 = time.monotonic()
        game.start()
        await self.flush(refresh=True)
        last_refresh = time.monotonic()
        while not game.ended:
            self.reap()
            game.tick(self.now())
            stop = None if game.ended else self.check_stop()
            if stop:
                self.stop_reason = stop
                game.end("stopped")
                if stop != self.exp_stop:
                    await self.request_stop(stop)
                break
            self.spawn_calls()
            due = time.monotonic() - last_refresh >= REFRESH_S
            await self.flush(refresh=due)
            if due:
                last_refresh = time.monotonic()
            await asyncio.sleep(tick_ms / 1000)
        tasks = list(self.inflight.values())
        if tasks and game.ended != "stopped":
            await asyncio.wait(tasks, timeout=END_WAIT_S)
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.inflight.clear()
        await self.flush()

    def cancel_agents(self):
        for t in self.inflight.values():
            t.cancel()


async def execute_run(run_id: int, *, mode: str = "llm", tick_ms: int | None = None):
    r: _Run | None = None
    try:
        async with SessionLocal() as db:
            run = await db.get(Run, run_id)
            exp = await db.get(Experiment, run.experiment_id) if run.experiment_id else None
            if mode == "llm" and exp is None:
                raise ValueError("an LLM run needs an experiment")
            key_row = await db.get(ApiKey, exp.user_id) if mode == "llm" else None
            r = _Run(run, exp, mode, decrypt(key_row.ciphertext) if key_row else None)
            run.status, run.started_at = "running", datetime.now(UTC)
            await db.commit()

        await r.play(tick_ms or TICK_MS)

        game = r.game
        ended = game.events[-1]["data"]
        result = {"solved": ended["solved"], "duration_ms": ended["duration_ms"], "end_reason": ended["reason"],
                  "goals_met": ended["met"], "completion": ended["completion"], "seed": r.seed,
                  "rate_limited_calls": r.rate_limited}
        measure_cost = 0.0
        if mode == "llm" and game.ended != "stopped":
            async with SessionLocal() as db:
                run = await db.get(Run, run_id)
                run.status = "measuring"
                exp = await db.get(Experiment, r.exp_id)
                budget_left = max(0.0, exp.cap_usd - exp.spent_usd)
                await db.commit()
            try:
                measured = await measure.measure_run(
                    events=game.events, decisions=r.decisions,
                    label_fn=measure.make_label_fn(r.client, r.model, r.effort),
                    replay_fn=measure.make_replay_fn(llm.call_decision, r.client, r.effort),
                    min_influence=r.min_influence, budget_left_usd=budget_left,
                )
                measure_cost = measured.get("measure_cost_usd") or 0.0
                result = {**measured, **result}
            except Exception as e:  # noqa: BLE001  (a measurement failure keeps the played game)
                log.exception("measurement of run %s failed", run_id)
                result["measure_error"] = f"{type(e).__name__}: {e}"[:500]

        async with SessionLocal() as db:
            run = await db.get(Run, run_id)
            run.status = "stopped" if game.ended == "stopped" else "finished"
            run.end_reason, run.result, run.ended_at = game.ended, result, datetime.now(UTC)
            run.cost_usd += measure_cost
            if measure_cost and r.exp_id is not None:
                await db.execute(update(Experiment).where(Experiment.id == r.exp_id)
                                 .values(spent_usd=Experiment.spent_usd + measure_cost))
            await db.commit()
    except asyncio.CancelledError:
        raise  # delete / shutdown: rows are deleted, or startup recovery marks them server_restart
    except Exception:
        log.exception("run %s failed", run_id)
        try:
            async with SessionLocal() as db:
                await db.execute(update(Run).where(Run.id == run_id).values(
                    status="failed", end_reason="error", ended_at=datetime.now(UTC)))
                await db.commit()
        except Exception:  # noqa: BLE001
            log.exception("could not mark run %s failed", run_id)
    finally:
        if r is not None:
            r.cancel_agents()
        hub.publish(run_id, None)
