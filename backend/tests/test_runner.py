import asyncio
import re
import time
from types import SimpleNamespace

import anthropic
import httpx2
import pytest
from sqlalchemy import select

from app import runner, scheduler
from app.agents import llm
from app.agents.llm import Decision
from app.agents.prompts import LEADER_LINES
from app.db import SessionLocal
from app.measure import run as measure
from app.models import ApiKey, Decision as DecisionRow, Experiment, Run, RunEvent, User
from app.security import encrypt
from app.settings_store import DEFAULTS

FAST = {"cell_seconds": 0.02, "flip_seconds": 0.02, "heartbeat_s": 0.2, "time_limit_s": 20, "parallel_runs": 1,
        "min_call_gap_s": 0}
DONE = ("finished", "stopped", "failed")
MEASURE = {"cost": 0.0}


async def fake_measure(**kw):
    return {"measured_leader": None, "partial": False, "measure_cost_usd": MEASURE["cost"]}


@pytest.fixture(autouse=True)
async def fast(monkeypatch):
    for k, v in FAST.items():
        monkeypatch.setitem(DEFAULTS, k, v)
    monkeypatch.setattr(runner, "TICK_MS", 10)
    monkeypatch.setattr(runner, "REFRESH_S", 0.05)
    monkeypatch.setattr(measure, "measure_run", fake_measure)
    MEASURE["cost"] = 0.0
    yield
    await scheduler.shutdown()
    from app.routers import dev

    for t in list(dev._tasks):
        t.cancel()
    await asyncio.gather(*dev._tasks, return_exceptions=True)


def fake_client(behave, delay=0.0, stats=None):
    """messages.parse -> behave(agent, request kwargs) -> Decision (or raises)."""
    async def parse(**kw):
        agent = re.search(r"You are (\w+)\.", kw["system"]).group(1)
        if stats is not None:
            stats["now"][agent] = stats["now"].get(agent, 0) + 1
            stats["max"][agent] = max(stats["max"].get(agent, 0), stats["now"][agent])
        try:
            if delay:
                await asyncio.sleep(delay)
            d = behave(agent, kw)
        finally:
            if stats is not None:
                stats["now"][agent] -= 1
        return SimpleNamespace(parsed_output=d, stop_reason="end_turn",
                               usage=SimpleNamespace(input_tokens=1200, output_tokens=300),
                               to_dict=lambda mode="python": {})
    return SimpleNamespace(messages=SimpleNamespace(parse=parse))


def use_client(monkeypatch, behave, **kw):
    client = fake_client(behave, **kw)
    monkeypatch.setattr(llm, "make_client", lambda key: client)
    return client


def text_of(kw) -> str:
    return "\n".join(b["text"] for b in kw["messages"][0]["content"])


def wait_all(agent, kw):
    return Decision(action="wait")


def chatty(agent, kw):
    return Decision(action="continue", message=f"hi from {agent}")


async def add_key(email="user@example.com"):
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))
        db.add(ApiKey(user_id=user.id, ciphertext=encrypt("sk-ant-test-key"), last4="-key"))
        await db.commit()


async def create(c, **cfg) -> int:
    body = {"name": "exp", "budget": [5, 5, 5, 5], "runs": 1, "model": "claude-haiku-5-5", "cap_usd": 5.0, **cfg}
    r = await c.post("/api/experiments", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def state(exp_id):
    async with SessionLocal() as db:
        exp = await db.get(Experiment, exp_id)
        runs = (await db.scalars(select(Run).where(Run.experiment_id == exp_id).order_by(Run.id))).all()
        return exp, list(runs)


async def wait_for(pred, timeout=20.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        v = await pred()
        if v:
            return v
        await asyncio.sleep(0.05)
    raise AssertionError("timed out")


async def wait_exp(exp_id, statuses=("finished", "stopped")):
    async def done():
        exp, runs = await state(exp_id)
        return (exp, runs) if exp.status in statuses else None
    return await wait_for(done)


async def decisions(run_id, agent=None):
    async with SessionLocal() as db:
        q = select(DecisionRow).where(DecisionRow.run_id == run_id)
        if agent:
            q = q.where(DecisionRow.agent == agent)
        return list((await db.scalars(q.order_by(DecisionRow.id))).all())


async def events(run_id):
    async with SessionLocal() as db:
        return list((await db.scalars(select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.seq))).all())


# ---- scripted / dev runs ------------------------------------------------------------------


async def test_scripted_run_persists_events_and_solves(client):
    run_id = (await client.post("/api/dev/scripted-run")).json()["run_id"]

    async def done():
        r = (await client.get(f"/api/runs/{run_id}")).json()
        return r if r["status"] in DONE else None
    run = await wait_for(done)
    assert run["status"] == "finished" and run["end_reason"] == "solved", run
    assert run["result"]["solved"] is True and all(run["result"]["goals_met"].values())
    evs = (await client.get(f"/api/runs/{run_id}/events")).json()
    assert [e["seq"] for e in evs] == list(range(1, len(evs) + 1))
    assert evs[0]["type"] == "run_started" and evs[-1]["type"] == "run_ended"
    assert {"agent_step", "chair_taken", "chair_dropped", "decision", "message"} <= {e["type"] for e in evs}
    assert run["cost_usd"] == 0


# ---- LLM agents (fake client) -------------------------------------------------------------


async def test_one_call_in_flight_per_agent(auth_client, monkeypatch):
    monkeypatch.setitem(DEFAULTS, "call_limit", 4)  # below the gridlock count, so the call limit ends it
    stats = {"now": {}, "max": {}}
    seen = []

    def behave(agent, kw):
        seen.append(text_of(kw))
        return chatty(agent, kw)
    use_client(monkeypatch, behave, delay=0.05, stats=stats)
    await add_key()
    exp, runs = await wait_exp(await create(auth_client))
    assert runs[0].status == "finished" and runs[0].end_reason == "call_limit"
    assert stats["max"] == {"Sam": 1, "Sky": 1, "Sol": 1, "Sage": 1}
    # messages that arrived during a slow call are all in the single follow-up call
    assert max(t.count("New chat message from") for t in seen) >= 2
    assert runs[0].cost_usd > 0 and exp.spent_usd == pytest.approx(runs[0].cost_usd)
    rows = await decisions(runs[0].id, "Sam")
    assert [d.seq for d in rows] == list(range(1, len(rows) + 1))


async def test_invalid_then_valid_retry(auth_client, monkeypatch):
    def behave(agent, kw):
        if agent == "Sam" and "could not be used" not in text_of(kw):
            return Decision(action="move", chair=99, x=1, y=1)
        return Decision(action="wait")
    use_client(monkeypatch, behave)
    await add_key()
    _, runs = await wait_exp(await create(auth_client))
    assert runs[0].status == "finished" and runs[0].end_reason == "all_waiting"
    ada = await decisions(runs[0].id, "Sam")
    assert [d.outcome for d in ada[:2]] == ["invalid", "skipped_chose"]
    retry_text = text_of(ada[1].request)
    assert "Your last answer could not be used: Chair 99 does not exist." in retry_text
    evs = [e.data for e in await events(runs[0].id) if e.type == "decision" and e.data["agent"] == "Sam"]
    assert evs[0]["outcome"] == "invalid" and evs[0]["n"] == 1 and evs[1]["outcome"] == "skipped_chose"


async def test_invalid_twice_skipped(auth_client, monkeypatch):
    def behave(agent, kw):
        return Decision(action="flip", chair=99) if agent == "Sam" else Decision(action="wait")
    use_client(monkeypatch, behave)
    await add_key()
    _, runs = await wait_exp(await create(auth_client))
    assert runs[0].status == "finished"
    ada = await decisions(runs[0].id, "Sam")
    assert [d.outcome for d in ada[:2]] == ["invalid", "skipped_invalid"]
    evs = await events(runs[0].id)
    assert not [e for e in evs if e.type == "chair_taken" and e.data["agent"] == "Sam"]  # no budget spent


async def test_rate_limit_is_retried_later_not_invalid(auth_client, monkeypatch):
    monkeypatch.setattr(runner, "RETRY_LATER_MS", 50)
    seen = set()

    def behave(agent, kw):
        if agent == "Sam" and "Sam" not in seen:
            seen.add("Sam")
            raise anthropic.RateLimitError(
                "slow down", response=httpx2.Response(429, request=httpx2.Request("POST", "https://x")), body=None)
        return Decision(action="wait")
    use_client(monkeypatch, behave)
    await add_key()
    _, runs = await wait_exp(await create(auth_client))
    assert runs[0].status == "finished" and runs[0].result["rate_limited_calls"] == 1
    ada = await decisions(runs[0].id, "Sam")
    assert ada[0].outcome == "skipped_chose"  # the 429 left no invalid decision behind
    assert "The game has started." in ada[0].trigger  # its news was kept for the next call


async def test_auth_error_stops_experiment(auth_client, monkeypatch):
    def behave(agent, kw):
        if LEADER_LINES["free"] in kw["system"]:
            raise anthropic.AuthenticationError(
                "bad key", response=httpx2.Response(401, request=httpx2.Request("POST", "https://x")), body=None)
        return Decision(action="wait")
    use_client(monkeypatch, behave)
    await add_key()
    exp, runs = await wait_exp(await create(auth_client, add_leader=True))
    assert exp.status == "stopped" and exp.stop_reason == "invalid_key"
    by_group = {r.group: r for r in runs}
    assert by_group["none"].status == "finished"
    assert by_group["free"].status == "stopped" and by_group["free"].end_reason == "stopped"
    assert by_group["directive"].status == "stopped" and by_group["nondirective"].status == "stopped"


async def test_cap_stops_experiment_keeps_finished(auth_client, monkeypatch):
    MEASURE["cost"] = 1.0  # measurement of run 1 pushes spending over the cap
    use_client(monkeypatch, wait_all)
    await add_key()
    exp, runs = await wait_exp(await create(auth_client, runs=2, cap_usd=0.5))
    assert exp.status == "stopped" and exp.stop_reason == "cap_reached"
    assert [r.status for r in runs] == ["finished", "stopped"]
    assert runs[0].result["end_reason"] == "all_waiting" and runs[0].cost_usd > 1.0


async def _running(exp_id):
    _, runs = await state(exp_id)
    return any(r.status == "running" for r in runs)


async def test_key_delete_stops_experiment(auth_client, monkeypatch):
    monkeypatch.setitem(DEFAULTS, "call_limit", 10_000)
    use_client(monkeypatch, chatty, delay=0.02)
    await add_key()
    exp_id = await create(auth_client, runs=2)
    await wait_for(lambda: _running(exp_id))
    assert (await auth_client.delete("/api/key")).status_code == 204
    exp, runs = await wait_exp(exp_id)
    assert exp.status == "stopped" and exp.stop_reason == "key_deleted"
    assert [r.status for r in runs] == ["stopped", "stopped"]
    assert runs[0].end_reason == "stopped" and runs[0].result["end_reason"] == "stopped"


async def test_stop_marks_running_stopped(auth_client, monkeypatch):
    monkeypatch.setitem(DEFAULTS, "call_limit", 10_000)
    use_client(monkeypatch, chatty, delay=0.02)
    await add_key()
    exp_id = await create(auth_client, runs=2)
    await wait_for(lambda: _running(exp_id))
    assert (await auth_client.post(f"/api/experiments/{exp_id}/stop")).status_code == 204
    exp, runs = await wait_exp(exp_id)
    assert exp.status == "stopped" and exp.stop_reason == "user_stopped"
    assert [r.status for r in runs] == ["stopped", "stopped"]
    evs = await events(runs[0].id)
    assert evs[-1].type == "run_ended" and evs[-1].data["reason"] == "stopped"
    detail = (await auth_client.get(f"/api/experiments/{exp_id}")).json()
    assert detail["status"] == "stopped" and detail["runs_done"] == 2


async def test_startup_marks_interrupted_runs_failed(db_setup, monkeypatch):
    launched = []
    monkeypatch.setattr(scheduler, "launch", launched.append)
    async with SessionLocal() as db:
        user = User(email="x@example.com", password_hash="x")
        db.add(user)
        await db.flush()
        exp = Experiment(user_id=user.id, name="e", config={}, status="running")
        done = Experiment(user_id=user.id, name="d", config={}, status="finished")
        db.add_all([exp, done])
        await db.flush()
        db.add_all([Run(experiment_id=exp.id, group="none", layout_no=i, status=s, result={})
                    for i, s in enumerate(["finished", "running", "measuring", "queued"], 1)])
        await db.commit()
        exp_id = exp.id
    await scheduler.start()
    _, runs = await state(exp_id)
    assert [(r.status, r.end_reason) for r in runs] == [
        ("finished", None), ("failed", "server_restart"), ("failed", "server_restart"), ("queued", None)]
    assert launched == [exp_id]


async def test_custom_leader_prompt_reaches_only_the_leader(auth_client, monkeypatch):
    systems: list[str] = []

    def behave(agent, kw):
        systems.append(kw["system"])
        return Decision(action="wait")
    use_client(monkeypatch, behave)
    await add_key()
    custom = "Tell the others which chair to take next."
    exp, runs = await wait_exp(await create(auth_client, add_leader=True, leader_prompts={"directive": custom}))
    directive = next(r for r in runs if r.group == "directive")
    assert directive.result["seed"] == directive.seed
    async with SessionLocal() as db:
        events = (await db.scalars(select(RunEvent).where(RunEvent.run_id == directive.id))).all()
    started = next(e.data for e in events if e.type == "run_started")
    leader = next(a["name"] for a in started["agents"] if a["is_leader"])
    assert started["seed"] == directive.seed and started["target_zone"] in range(4)
    with_custom = {p for p in systems if custom in p}
    assert len(with_custom) == 1 and with_custom.pop().endswith(custom)  # one leader, one run (directive)
    assert sum(LEADER_LINES["free"] in p for p in set(systems)) == 1 and leader
