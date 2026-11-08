"""Measure one finished run (docs/contracts.md "Run result", measure_version 2).

1. Label every chat message: style, instructions (one agent or several, move / flip / avoid one chair) and proposed
   target cells (a plan).
2. Build tests. Only a recipient's decisions whose request already contained the message count:
   - instruction: the recipient did it within its next FOLLOW_WINDOW acting decisions -> test that decision;
   - prohibition: test the recipient's next idle decision (does it touch the chair less with the message?);
   - plan: the recipient's next acting decision carried a chair onto a proposed cell -> test that decision.
   Copies are merged: one test per (follower decision, sender), with all of that sender's messages behind it removed
   in the "without" replays, so a follower action is credited once.
3. Each test replays the decision N_REPLAYS_EACH times with the message(s) and N_REPLAYS_EACH times without.
   A test that cannot be run is missing (score None, with a reason), never 0.

LLM access is injected (label_fn / replay_fn) so this module never imports app.agents.llm.
"""

import asyncio
import copy

from app.measure import score
from app.measure.config import (CONCURRENCY, FOLLOW_WINDOW, LEADER_MARGIN, MEASURE_VERSION, MIN_VALID_REPLAYS,
                                N_REPLAYS_EACH)
from app.measure.label import label_message

_SKIP = object()  # call not made because the budget ran out
TYPES = ("instruction", "prohibition", "plan")


def remove_chat_lines(request: dict, message_ids) -> dict:
    """Copy of a stored decision request without the chat lines `[m{id}] ...` (contract: chat = 2nd text block)."""
    req = copy.deepcopy(request)
    block = req["messages"][0]["content"][1]
    header, *lines = block["text"].split("\n")
    prefixes = tuple(f"[m{i}] " for i in message_ids)
    kept = [ln for ln in lines if not ln.startswith(prefixes) and ln != "(none)"]
    block["text"] = "\n".join([header, *(kept or ["(none)"])])
    return req


def remove_chat_line(request: dict, message_id: int) -> dict:
    return remove_chat_lines(request, [message_id])


def _text(d: dict, block: int) -> str:
    try:
        return d["request"]["messages"][0]["content"][block]["text"]
    except (KeyError, IndexError, TypeError):
        return ""


def saw(d: dict, message_id: int) -> bool:
    """The decision's request already contained the message."""
    return f"\n[m{message_id}] " in "\n" + _text(d, 1)


def _idle(d: dict) -> bool:
    return "- State: idle." in _text(d, 0)


def _action(ins) -> dict:
    cell = [ins.x, ins.y] if ins.x is not None and ins.y is not None else None
    return {"kind": ins.kind, "chair": ins.chair, "cell": cell}


async def measure_run(*, events: list[dict], decisions: list[dict], label_fn, replay_fn,
                      min_influence: float, budget_left_usd: float | None) -> dict:
    started = next((e["data"] for e in events if e["type"] == "run_started"), {})
    ended = next((e["data"] for e in events if e["type"] == "run_ended"), {})
    agents_info = started.get("agents", [])
    agents = [a["name"] for a in agents_info]
    msgs = [(e["t"], e["data"]) for e in events if e["type"] == "message"]
    by_agent = {a: sorted((d for d in decisions if d["agent"] == a), key=lambda d: (d["t_ms"], d["seq"])) for a in agents}

    sem = asyncio.Semaphore(CONCURRENCY)
    spent = 0.0
    partial = False

    async def call(fn, *args):
        nonlocal spent, partial
        async with sem:
            # ponytail: checked before each call, so in-flight calls (≤ CONCURRENCY) may overshoot the budget slightly.
            if budget_left_usd is not None and spent >= budget_left_usd:
                partial = True
                return _SKIP
            out, cost = await fn(*args)
            spent += cost
            return out

    labels = await asyncio.gather(*(call(label_fn, m["agent"], m["text"], agents) for _, m in msgs))

    styles: dict[str, str] = {}
    sent_styles: list[tuple[str, str]] = []
    entries: list[dict] = []  # one per (message, recipient, instruction or plan), shown in the viewer and exports
    tests: dict[tuple, dict] = {}  # merged copies: key -> {type, from, to, decision, mids, hit, entries}
    plans = []  # (message, sender, cells): handled after all instructions, so instruction credit wins

    def add_test(key, kind, sender, to, d, mid, hit, entry):
        test = tests.setdefault(key, {"type": kind, "from": sender, "to": to, "decision": d, "mids": [], "hit": hit,
                                      "entries": []})
        if mid not in test["mids"]:
            test["mids"].append(mid)
        test["entries"].append(entry)

    for (_, m), label in zip(msgs, labels):
        if label is _SKIP or label is None:
            continue
        mid, sender = m["id"], m["agent"]
        styles[str(mid)] = label.style
        sent_styles.append((sender, label.style))
        others = [a for a in agents if a != sender]
        for ins in label.instructions:
            # Trust boundary: recipients must be named other agents of this run.
            for to in [a for a in dict.fromkeys(ins.to) if a in others]:
                seen = [d for d in by_agent[to] if saw(d, mid)]
                kind = "prohibition" if ins.kind == "avoid" else "instruction"
                entry = {"message_id": mid, "from": sender, "to": to, "type": kind, "action": _action(ins),
                         "followed": None, "p_with": None, "p_without": None, "score": None, "untested_reason": None}
                entries.append(entry)
                if not seen:
                    entry["untested_reason"] = "message_not_seen"
                    continue
                if kind == "prohibition":
                    acting = [d for d in seen if score.is_acting(d)][:FOLLOW_WINDOW]
                    entry["followed"] = not any(score.touches(d["action"], ins.chair) for d in acting)
                    target = next((d for d in seen if _idle(d)), None)
                    if target is None:
                        entry["untested_reason"] = "no_idle_decision"
                        continue
                    chair = ins.chair
                    add_test(("prohibition", to, target["seq"], sender, chair), kind, sender, to, target, mid,
                             lambda a, chair=chair: score.touches(a, chair), entry)
                    continue
                match = score.followed(ins, seen)
                entry["followed"] = match is not None
                if match is None:
                    entry["score"] = 0.0  # observed not following: no influence, not missing
                    continue
                add_test(("instruction", to, match["seq"], sender), kind, sender, to, match, mid,
                         lambda a, ins=ins: score.matches(ins, a), entry)
        cells = {(c.x, c.y) for c in label.proposed_cells if 0 <= c.x < 8 and 0 <= c.y < 8}
        if cells:
            plans.append((m, sender, cells))

    for m, sender, cells in plans:
        mid = m["id"]
        for to in (a for a in agents if a != sender):
            first = next((d for d in by_agent[to] if saw(d, mid) and score.is_acting(d)), None)
            if first is None or not score.moves_to(first["action"], cells):
                continue  # plan not adopted by this agent: nothing to test
            if ("instruction", to, first["seq"], sender) in tests:
                continue  # this action is already credited to the sender as a followed instruction
            entry = {"message_id": mid, "from": sender, "to": to, "type": "plan", "action": dict(first["action"]),
                     "followed": True, "p_with": None, "p_without": None, "score": None, "untested_reason": None}
            entries.append(entry)
            key = ("plan", to, first["seq"], sender)
            add_test(key, "plan", sender, to, first, mid, None, entry)
            tests[key].setdefault("cells", set()).update(cells)
    for test in tests.values():
        if test["type"] == "plan":
            test["hit"] = lambda a, cells=test["cells"]: score.moves_to(a, cells)

    async def run_test(test):
        req = test["decision"]["request"]
        without = remove_chat_lines(req, test["mids"])
        if without == req:
            return None, None, "message_not_seen"
        outs = await asyncio.gather(*(call(replay_fn, r) for r in [req] * N_REPLAYS_EACH + [without] * N_REPLAYS_EACH))
        if any(o is _SKIP for o in outs):
            return None, None, "over_budget"
        w = [o for o in outs[:N_REPLAYS_EACH] if o is not None]
        wo = [o for o in outs[N_REPLAYS_EACH:] if o is not None]
        if len(w) < MIN_VALID_REPLAYS or len(wo) < MIN_VALID_REPLAYS:
            return None, None, "replay_failed"
        return sum(map(test["hit"], w)) / len(w), sum(map(test["hit"], wo)) / len(wo), None

    results = await asyncio.gather(*(run_test(t) for t in tests.values()))

    influence = dict.fromkeys(agents, 0.0)
    received = dict.fromkeys(agents, 0.0)
    by_type = {a: dict.fromkeys(TYPES, 0.0) for a in agents}
    followers: dict[str, set] = {a: set() for a in agents}
    for test, (p_with, p_without, reason) in zip(tests.values(), results):
        s = None
        if reason is None:
            # A prohibition works when the chair is touched less often with the message than without it.
            s = score.instruction_score(p_without, p_with) if test["type"] == "prohibition" else score.instruction_score(p_with, p_without)
            influence[test["from"]] += s
            received[test["to"]] += s
            by_type[test["from"]][test["type"]] += s
            if s > 0:
                followers[test["from"]].add(test["to"])
        for entry in test["entries"]:
            entry.update(p_with=None if p_with is None else round(p_with, 4),
                         p_without=None if p_without is None else round(p_without, 4),
                         score=None if s is None else round(s, 4), untested_reason=reason)

    tested = sum(e["score"] is not None for e in entries)
    untested: dict[str, int] = {}
    for e in entries:
        if e["untested_reason"]:
            untested[e["untested_reason"]] = untested.get(e["untested_reason"], 0) + 1

    leader_agent = next((a["name"] for a in agents_info if a.get("is_leader")), None)
    richest = score.richest_agent({a["name"]: a["budget"] for a in agents_info})
    shares = score.shares(influence)
    target = leader_agent or richest  # the agent the 25% chance line is about: told to lead, else richest
    n_invalid = sum(d["outcome"] == "skipped_invalid" for d in decisions)
    rnd = lambda v: None if v is None else round(v, 4)  # noqa: E731
    return {
        "measure_version": MEASURE_VERSION,
        "solved": ended.get("solved"),
        "duration_ms": ended.get("duration_ms"),
        "end_reason": ended.get("reason"),
        "goals_met": ended.get("met"),
        "leader_agent": leader_agent,
        "richest_agent": richest,
        "leader_is_richest": None if leader_agent is None or richest is None else leader_agent == richest,
        "target_agent": target,
        "target_share": rnd(shares.get(target)) if target else None,
        "share_by_goal": {a["goal"]: rnd(shares.get(a["name"])) for a in agents_info if isinstance(a.get("goal"), str)},
        "measured_leader": score.measured_leader(influence, followers, min_influence, 1, LEADER_MARGIN),
        "measured_leader_strict": score.measured_leader(influence, followers, min_influence, 2, LEADER_MARGIN),
        "influence": {a: round(v, 4) for a, v in influence.items()},
        "influence_by_type": {a: {k: round(v, 4) for k, v in t.items()} for a, t in by_type.items()},
        "influence_received": {a: round(v, 4) for a, v in received.items()},
        "influence_share": {a: rnd(v) for a, v in shares.items()},
        "followers": {a: sorted(f) for a, f in followers.items()},
        "instructions": sorted(entries, key=lambda e: e["message_id"]),
        "tests": {"run": len(tests), "entries_scored": tested, "untested": untested},
        "styles": styles,
        "style_mix": score.style_mix(sent_styles, agents),
        "invalid_share": round(n_invalid / len(decisions), 4) if decisions else 0.0,
        "partial": partial,
        "measure_cost_usd": round(spent, 6),
    }


def make_label_fn(client, model: str, effort: str):
    async def label_fn(sender: str, text: str, agents: list[str]):
        return await label_message(client, model, sender, text, agents, effort)
    return label_fn


def make_replay_fn(call_decision, client, effort: str):
    """call_decision is app.agents.llm.call_decision (injected so measure never imports it at module level)."""
    async def replay_fn(request: dict):
        res = await call_decision(client, request, effort)
        d = res.decision
        if d is None:
            return None, res.cost_usd
        cell = [d.x, d.y] if d.x is not None and d.y is not None else None
        return {"kind": d.action, "chair": d.chair, "cell": cell}, res.cost_usd
    return replay_fn
