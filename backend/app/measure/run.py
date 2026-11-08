"""Measure one finished run: label messages, check followed instructions, counterfactual replays, scores.

LLM access is injected (label_fn / replay_fn) so this module never imports app.agents.llm.
"""

import asyncio
import copy

from app.measure import score
from app.measure.config import CONCURRENCY, N_REPLAYS_EACH
from app.measure.label import label_message

_SKIP = object()  # call not made because the budget ran out


def remove_chat_line(request: dict, message_id: int) -> dict:
    """Copy of a stored decision request with chat line `[m{id}] ...` removed (contract: chat = 2nd text block)."""
    req = copy.deepcopy(request)
    block = req["messages"][0]["content"][1]
    header, *lines = block["text"].split("\n")
    prefix = f"[m{message_id}] "
    kept = [ln for ln in lines if not ln.startswith(prefix) and ln != "(none)"]
    block["text"] = "\n".join([header, *(kept or ["(none)"])])
    return req


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
    jobs = []  # (entry, instruction, replays future | None)
    for (t, m), label in zip(msgs, labels):
        if label is _SKIP or label is None:
            continue
        styles[str(m["id"])] = label.style
        sent_styles.append((m["agent"], label.style))
        ins = label.instruction
        # Trust boundary: the recipient must be one named other agent of this run.
        if ins is None or ins.to not in agents or ins.to == m["agent"]:
            continue
        ok, dec = score.followed(ins, t, [d for d in decisions if d["agent"] == ins.to])
        entry = {"message_id": m["id"], "from": m["agent"], "to": ins.to, "action": _action(ins),
                 "followed": ok, "p_with": None, "p_without": None, "score": 0.0}
        coro = None
        if ok:
            without = remove_chat_line(dec["request"], m["id"])
            if without != dec["request"]:  # message not in the request → it could not have caused the decision
                coro = asyncio.gather(*(call(replay_fn, r) for r in [dec["request"]] * N_REPLAYS_EACH + [without] * N_REPLAYS_EACH))
        jobs.append((entry, ins, coro))

    replays = await asyncio.gather(*(c for _, _, c in jobs if c is not None))
    it = iter(replays)
    influence = dict.fromkeys(agents, 0.0)
    received = dict.fromkeys(agents, 0.0)
    followers: dict[str, set] = {a: set() for a in agents}
    for entry, ins, coro in jobs:
        if coro is None:
            continue
        outs = next(it)
        if any(o is _SKIP for o in outs):
            continue  # incomplete replays: unscored, run marked partial
        p_with = sum(score.matches(ins, o) for o in outs[:N_REPLAYS_EACH]) / N_REPLAYS_EACH
        p_without = sum(score.matches(ins, o) for o in outs[N_REPLAYS_EACH:]) / N_REPLAYS_EACH
        s = score.instruction_score(p_with, p_without)
        entry.update(p_with=round(p_with, 4), p_without=round(p_without, 4), score=round(s, 4))
        influence[entry["from"]] += s
        received[entry["to"]] += s
        if s > 0:
            followers[entry["from"]].add(entry["to"])

    leader_agent = next((a["name"] for a in agents_info if a.get("is_leader")), None)
    richest = score.richest_agent({a["name"]: a["budget"] for a in agents_info})
    n_invalid = sum(d["outcome"] == "skipped_invalid" for d in decisions)
    return {
        "solved": ended.get("solved"),
        "duration_ms": ended.get("duration_ms"),
        "end_reason": ended.get("reason"),
        "goals_met": ended.get("met"),
        "leader_agent": leader_agent,
        "richest_agent": richest,
        "leader_is_richest": None if leader_agent is None or richest is None else leader_agent == richest,
        "measured_leader": score.measured_leader(influence, followers, min_influence),
        "influence": {a: round(v, 4) for a, v in influence.items()},
        "influence_received": {a: round(v, 4) for a, v in received.items()},
        "influence_share": {a: round(v, 4) for a, v in score.shares(influence).items()},
        "instructions": [e for e, _, _ in jobs],
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
