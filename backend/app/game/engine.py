"""Real-time chairs game. Pure: no I/O, no wall clock. The runner drives it with tick(now_ms).

Agent states: idle | walking (to a chair) | carrying (held chair to a cell) | flipping.
Each busy agent has one pending `due` time (end of its current step or flip); tick() processes
every due time in order, so large jumps behave exactly like many small ticks.
"""

import random
from dataclasses import dataclass

from app.game.board import GOALS, GRID, in_grid
from app.game.goals import goals_met
from app.game.solver import completion

KINDS = ("move", "flip", "put_down", "continue", "wait")
QUIET_EVENTS = {"decision", "notes", "cost"}  # do not count as a state change for all_waiting
GRIDLOCK_MESSAGES = 5  # every agent sent this many chat messages since it last took a chair -> run ends


@dataclass
class GameConfig:
    cell_ms: int = 2000
    flip_ms: int = 2000
    time_limit_ms: int = 600_000
    heartbeat_ms: int = 10_000
    know_all_goals: bool = False
    leader: str | None = None
    leader_style: str | None = None


def _fmt(cell) -> str:
    return f"({cell[0]}, {cell[1]})"


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


class Game:
    def __init__(self, layout, cfg: GameConfig, group: str = "none", seed: int = 0):
        self.layout, self.cfg, self.group = layout, cfg, group
        self.seed = seed
        self.rng = random.Random(seed)
        self.t = 0
        self.ended: str | None = None
        self.events: list[dict] = []
        self.chat: list[dict] = []
        self._drained = 0
        self._met: dict | None = None
        self._last_change = 0
        # Solved and completion only exist when every agent has a built-in goal the game can check.
        self.checkable = all(g in GOALS for g in layout.goals.values())
        self.chairs = {cid: {"cell": tuple(cell), "upside_down": False, "held_by": None} for cid, cell in layout.chairs}
        self.agents = {
            name: {
                "cell": tuple(cell), "budget": layout.budgets[name], "goal": layout.goals[name],
                "state": "idle", "holding": None, "plan": None, "step_to": None, "due": None,
                "triggers": [], "notes": "", "last_kind": None, "last_t": 0, "talk_only": 0,
            }
            for name, cell in layout.agents
        }

    # ---- events -------------------------------------------------------------------------

    def emit(self, type: str, data: dict) -> dict | None:
        """Append an event (also used by the runner for `decision` / `cost`). Nothing after run_ended."""
        if self.ended:
            return None
        ev = {"seq": len(self.events) + 1, "t": self.t, "type": type, "data": data}
        self.events.append(ev)
        if type not in QUIET_EVENTS:
            self._last_change = self.t
        return ev

    def drain_events(self) -> list[dict]:
        new = self.events[self._drained:]
        self._drained = len(self.events)
        return new

    def _tell_others(self, name: str, text: str):
        for other, o in self.agents.items():
            if other != name:
                o["triggers"].append(text)

    # ---- lifecycle ----------------------------------------------------------------------

    def start(self):
        cfg = self.cfg
        self.emit("run_started", {
            "layout_no": self.layout.n, "group": self.group, "grid": GRID,
            "cell_ms": cfg.cell_ms, "flip_ms": cfg.flip_ms, "time_limit_ms": cfg.time_limit_ms,
            "know_all_goals": cfg.know_all_goals, "target_zone": self.layout.zone, "seed": self.seed,
            "min_actions": self.layout.min_actions,
            "agents": [
                {"name": n, "cell": list(a["cell"]), "goal": a["goal"], "budget": a["budget"],
                 "is_leader": n == cfg.leader, "leader_style": cfg.leader_style if n == cfg.leader else None}
                for n, a in self.agents.items()
            ],
            "chairs": [{"id": cid, "cell": list(ch["cell"]), "upside_down": ch["upside_down"]}
                       for cid, ch in self.chairs.items()],
        })
        for a in self.agents.values():
            a["triggers"].append("The game has started.")
        self._after_change()

    def end(self, reason: str):
        if self.ended:
            return
        met = goals_met(self.chairs.values(), self.layout.zone)
        if not self.checkable:
            done = None  # a custom goal: the game cannot tell how close the room is
        else:
            done = 1.0 if reason == "solved" else completion(self.chairs.values(), self.layout.min_actions, self.layout.zone)
        self.emit("run_ended", {"reason": reason, "solved": reason == "solved", "met": met, "duration_ms": self.t,
                                "completion": done})
        self.ended = reason

    def tick(self, now_ms: int):
        if self.ended:
            return
        limit = self.cfg.time_limit_ms
        end_at = min(now_ms, limit)
        while not self.ended:
            dues = [a["due"] for a in self.agents.values() if a["due"] is not None and a["due"] <= end_at]
            if not dues:
                break
            self.t = min(dues)
            names = sorted(n for n, a in self.agents.items() if a["due"] == self.t)
            self.rng.shuffle(names)  # same-moment arrivals: seeded random order decides who takes first
            for name in names:
                a = self.agents[name]
                if a["due"] != self.t:  # stopped by an earlier agent in this batch
                    continue
                if a["state"] == "flipping":
                    self._finish_flip(name)
                else:
                    self._finish_step(name)
            self._after_change()
        if self.ended:
            return
        self.t = max(self.t, end_at)
        if now_ms >= limit:
            self.end("time_limit")
        elif self._all_waiting():
            self.end("all_waiting")

    def _after_change(self):
        met = goals_met(self.chairs.values(), self.layout.zone)
        if met != self._met:
            self._met = met
            self.emit("goals", {"met": met})
        if any(ch["held_by"] for ch in self.chairs.values()):
            return
        if self.checkable and all(met.values()):
            self.end("solved")
        elif all(a["budget"] == 0 for a in self.agents.values()):
            self.end("budget_exhausted")

    def _all_waiting(self) -> bool:
        if self.t - self._last_change < self.cfg.heartbeat_ms:
            return False
        return all(
            a["state"] == "idle" and not a["triggers"] and a["last_kind"] in ("wait", "continue")
            and a["last_t"] >= self._last_change
            for a in self.agents.values()
        )

    # ---- runner-facing API --------------------------------------------------------------

    def take_triggers(self, agent: str) -> list[str]:
        a = self.agents[agent]
        out, a["triggers"] = a["triggers"], []
        return out

    def wants_call(self, agent: str, now_ms: int) -> bool:
        if self.ended:
            return False
        a = self.agents[agent]
        return bool(a["triggers"]) or (a["state"] == "idle" and now_ms - a["last_t"] >= self.cfg.heartbeat_ms)

    def is_busy(self, agent: str) -> bool:
        return self.agents[agent]["state"] != "idle"

    def record_decision(self, agent: str, kind: str, now_ms: int):
        a = self.agents[agent]
        a["last_kind"], a["last_t"] = kind, now_ms

    def say(self, agent: str, text: str) -> int:
        if self.ended:
            return 0
        text = text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")[:300]
        mid = len(self.chat) + 1
        self.chat.append({"id": mid, "agent": agent, "text": text, "t": self.t})
        self.emit("message", {"agent": agent, "id": mid, "text": text})
        self._tell_others(agent, f"New chat message from {agent}.")
        a = self.agents[agent]
        if a["state"] == "idle":  # talking while walking, carrying or flipping is not talk-only
            a["talk_only"] += 1
        if all(o["talk_only"] >= GRIDLOCK_MESSAGES for o in self.agents.values()):
            self.end("gridlock")
        return mid

    def set_notes(self, agent: str, text: str):
        self.agents[agent]["notes"] = text
        self.emit("notes", {"agent": agent, "text": text})

    def observation(self, agent: str) -> dict:
        a = self.agents[agent]
        met = goals_met(self.chairs.values(), self.layout.zone)
        left_ms = max(0, self.cfg.time_limit_ms - self.t)
        return {
            "t_ms": self.t,
            "time_left_s": -(-left_ms // 1000),
            "target_zone": self.layout.zone,
            "you": {
                "name": agent, "cell": list(a["cell"]), "state": a["state"], "holding": a["holding"],
                "heading": dict(a["plan"]) if a["plan"] else None,
                "budget_left": a["budget"], "goal": a["goal"], "goal_met": met.get(a["goal"]),
            },
            "others": [
                {"name": n, "cell": list(o["cell"]), "holding": o["holding"], "budget_left": o["budget"],
                 "goal": o["goal"] if self.cfg.know_all_goals else None}
                for n, o in self.agents.items() if n != agent
            ],
            "chairs": [
                {"id": cid, "cell": list(ch["cell"]), "upside_down": ch["upside_down"], "held_by": ch["held_by"]}
                for cid, ch in self.chairs.items()
            ],
        }

    def chair_on(self, cell, exclude: int | None = None) -> int | None:
        """Id of a chair standing on `cell` (free or being flipped). Carried chairs do not occupy cells."""
        cell = tuple(cell)
        for cid, ch in self.chairs.items():
            holder = ch["held_by"]
            if cid != exclude and ch["cell"] == cell and (holder is None or self.agents[holder]["state"] == "flipping"):
                return cid
        return None

    def decide(self, agent: str, kind: str, chair=None, cell=None) -> tuple[str, str | None]:
        if self.ended:
            return "invalid", "The game is over."
        if agent not in self.agents:
            return "invalid", f"Unknown agent {agent!r}."
        if kind not in KINDS:
            return "invalid", f"Unknown action {kind!r}."
        a = self.agents[agent]
        if kind == "continue":
            return "ok", None
        if a["state"] != "idle":
            return "ignored_busy", "You are busy; an action cannot be changed halfway through."
        if kind == "wait":
            return "ok", None
        here, held = a["cell"], a["holding"]
        if kind == "put_down":
            if held is None:
                return "invalid", "You are not holding a chair."
            if self.chair_on(here) is not None:
                return "invalid", f"Cell {_fmt(here)} already has a chair."
            self._drop(agent, tell_self=False)
            self._after_change()
            return "ok", None

        # move / flip
        if not _is_int(chair) or chair not in self.chairs:
            return "invalid", f"Chair {chair} does not exist."
        if kind == "move":
            if not (isinstance(cell, (list, tuple)) and len(cell) == 2 and all(_is_int(v) for v in cell) and in_grid(cell)):
                return "invalid", f"Cell {cell} is not on the 8x8 grid."
            cell = (cell[0], cell[1])
            other = self.chair_on(cell, exclude=chair)
            if other is not None:
                return "invalid", f"Cell {_fmt(cell)} already has chair {other}."
        carry_held = kind == "move" and held == chair
        if a["budget"] == 0 and not carry_held:
            return "invalid", "You have no actions left."
        if held is not None and not carry_held:
            if self.chair_on(here) is not None:
                return "invalid", f"You are holding chair {held} and cannot put it down first, because cell {_fmt(here)} already has a chair."
            if kind == "move" and cell == here:
                return "invalid", f"Cell {_fmt(here)} would have chair {held} once you put it down."
            self._drop(agent, tell_self=False)
        a["plan"] = {"kind": kind, "chair": chair, "cell": list(cell) if kind == "move" else None}
        a["state"] = "carrying" if carry_held else "walking"
        self._advance(agent)
        self._after_change()
        return "ok", None

    # ---- simulation internals -----------------------------------------------------------

    def _advance(self, name: str):
        """Agent stands on a cell at self.t: arrive, or start the next one-cell step (x first, then y)."""
        a = self.agents[name]
        plan = a["plan"]
        target = tuple(plan["cell"]) if a["state"] == "carrying" else self.chairs[plan["chair"]]["cell"]
        if a["cell"] == target:
            self._arrive(name)
            return
        (x, y), (tx, ty) = a["cell"], target
        nxt = (x + (tx > x) - (tx < x), y) if x != tx else (x, y + (ty > y) - (ty < y))
        a["step_to"], a["due"] = nxt, self.t + self.cfg.cell_ms
        self.emit("agent_step", {"agent": name, "from": list(a["cell"]), "to": list(nxt), "dur_ms": self.cfg.cell_ms})

    def _finish_step(self, name: str):
        a = self.agents[name]
        a["cell"], a["step_to"], a["due"] = a["step_to"], None, None
        if a["holding"] is not None:
            self.chairs[a["holding"]]["cell"] = a["cell"]
        self._advance(name)

    def _arrive(self, name: str):
        a = self.agents[name]
        plan = a["plan"]
        cid = plan["chair"]
        if a["state"] == "walking":
            holder = self.chairs[cid]["held_by"]
            if holder is not None:
                self._stop(name, "chair_taken", f"{holder} has chair {cid}, so you could not take it.")
                return
            self._take(name, cid, plan["kind"])
            if plan["kind"] == "flip":
                a["state"], a["due"] = "flipping", self.t + self.cfg.flip_ms
                self.emit("flip_started", {"agent": name, "chair": cid, "dur_ms": self.cfg.flip_ms})
                return
            a["state"] = "carrying"
            self._advance(name)
            return
        # carrying, at the destination cell
        if self.chair_on(a["cell"], exclude=cid) is not None:
            self._stop(name, "cell_occupied",
                       f"Cell {_fmt(a['cell'])} already has a chair, so you are still holding chair {cid}.")
            return
        self._drop(name, tell_self=True)

    def _take(self, name: str, cid: int, kind: str):
        a, ch = self.agents[name], self.chairs[cid]
        a["budget"] -= 1
        a["talk_only"] = 0
        a["holding"], ch["held_by"] = cid, name
        self.emit("chair_taken", {"agent": name, "chair": cid, "for": kind, "budget_left": a["budget"]})
        verb = "picked up" if kind == "move" else "started flipping"
        for other, o in self.agents.items():
            if other == name:
                continue
            if o["state"] == "walking" and o["plan"]["chair"] == cid:
                self._stop(other, "chair_taken", f"{name} took chair {cid}, which you were heading for.")
            else:
                o["triggers"].append(f"{name} {verb} chair {cid}.")

    def _drop(self, name: str, tell_self: bool):
        a = self.agents[name]
        cid = a["holding"]
        ch = self.chairs[cid]
        ch["cell"], ch["held_by"] = a["cell"], None
        a.update(holding=None, state="idle", plan=None, step_to=None, due=None)
        self.emit("chair_dropped", {"agent": name, "chair": cid, "cell": list(a["cell"])})
        if tell_self:
            a["triggers"].append(f"You put chair {cid} down at {_fmt(a['cell'])}.")
        self._tell_others(name, f"{name} put chair {cid} down at {_fmt(a['cell'])}.")

    def _finish_flip(self, name: str):
        a = self.agents[name]
        cid = a["holding"]
        ch = self.chairs[cid]
        ch["upside_down"], ch["held_by"] = not ch["upside_down"], None
        a.update(holding=None, state="idle", plan=None, due=None)
        self.emit("flip_done", {"agent": name, "chair": cid, "upside_down": ch["upside_down"]})
        state = "upside down" if ch["upside_down"] else "on its legs"
        a["triggers"].append(f"You flipped chair {cid}. It is now {state}.")
        self._tell_others(name, f"{name} finished flipping chair {cid}. It is now {state}.")

    def _stop(self, name: str, reason: str, text: str):
        """Interrupt a walk: the agent stays on the cell it last stood on and is idle (keeps any held chair)."""
        a = self.agents[name]
        a.update(state="idle", plan=None, step_to=None, due=None)
        self.emit("agent_stopped", {"agent": name, "cell": list(a["cell"]), "reason": reason})
        a["triggers"].append(text)
