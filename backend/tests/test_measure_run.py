from app.measure.label import Cell, Instruction, MessageLabel
from app.measure.run import make_replay_fn, measure_run

AGENTS = [("Sam", 9, False, "square"), ("Sky", 5, True, "upside_down"), ("Sol", 3, False, "one_zone"),
          ("Sage", 3, False, "touching")]
MSGS = [  # (id, t, sender, text)
    (1, 1000, "Sky", "Sol, flip chair 2"),
    (7, 1500, "Sky", "Sol, flip chair 2 now"),  # a copy: same sender, recipient and action
    (2, 3000, "Sky", "Sage, move chair 5 to [4,4]"),
    (3, 3500, "Sam", "Ring on [1,1] and [2,1]?"),
    (9, 3600, "Sky", "Sol, flip chair 8"),  # Sol does something else: not followed
    (4, 5000, "Sol", "someone flip chair 1"),
    (5, 5200, "Sky", "Sam, leave chair 6 alone"),
    (8, 7000, "Sky", "Sage, flip chair 4"),  # Sage never decides again: untestable
]


def ins(to, kind, chair, x=None, y=None):
    return Instruction(to=to, kind=kind, chair=chair, x=x, y=y)


LABELS = {
    1: MessageLabel(style="directive", instructions=[ins(["Sol"], "flip", 2)]),
    7: MessageLabel(style="directive", instructions=[ins(["Sol"], "flip", 2)]),
    2: MessageLabel(style="directive", instructions=[ins(["Sage"], "move", 5, 4, 4)]),
    3: MessageLabel(style="non_directive", proposed_cells=[Cell(x=1, y=1), Cell(x=2, y=1)]),
    9: MessageLabel(style="directive", instructions=[ins(["Sol"], "flip", 8)]),
    4: MessageLabel(style="other"),
    5: MessageLabel(style="directive", instructions=[ins(["Sam"], "avoid", 6)]),
    8: MessageLabel(style="directive", instructions=[ins(["Sage"], "flip", 4)]),
}


def events():
    ev = [{"seq": 1, "t": 0, "type": "run_started", "data": {"agents": [
        {"name": n, "cell": [0, 0], "goal": g, "budget": b, "is_leader": lead, "leader_style": "directive" if lead else None}
        for n, b, lead, g in AGENTS]}}]
    ev += [{"seq": i + 2, "t": t, "type": "message", "data": {"agent": a, "id": mid, "text": txt}}
           for i, (mid, t, a, txt) in enumerate(MSGS)]
    met = {"square": True, "upside_down": True, "one_zone": True, "touching": True}
    ev.append({"seq": 20, "t": 300000, "type": "run_ended",
               "data": {"reason": "solved", "solved": True, "met": met, "duration_ms": 300000}})
    return ev


def request_at(t, agent, msgs=MSGS):
    lines = [f"[m{mid}] {a}: {txt}" for mid, mt, a, txt in msgs if mt < t]
    chat = "Chat so far:\n" + ("\n".join(lines) or "(none)")
    return {"model": "m", "system": f"You are {agent}.", "messages": [{"role": "user", "content": [
        {"type": "text", "text": f"t={t}\n- State: idle. Holding: nothing."}, {"type": "text", "text": chat}]}]}


def decision(agent, seq, t, kind, chair=None, cell=None, outcome="ok", msgs=MSGS):
    return {"agent": agent, "seq": seq, "t_ms": t, "trigger": [], "request": request_at(t, agent, msgs), "response": {},
            "action": {"kind": kind, "chair": chair, "cell": cell}, "outcome": outcome}


DECISIONS = [
    decision("Sol", 1, 2000, "flip", 2),  # follows m1 (and its copy m7)
    decision("Sage", 1, 4000, "move", 5, [4, 4]),  # follows m2
    decision("Sam", 1, 4500, "wait", outcome="skipped_invalid"),
    decision("Sol", 2, 4600, "move", 3, [1, 1]),  # adopts Sam's plan (m3); ignores m9
    decision("Sam", 2, 6000, "flip", 1),  # first decision after the prohibition m5
]


async def label_fn(sender, text, agents):
    mid = next(m for m, _, _, txt in MSGS if txt == text)
    return LABELS[mid], 0.001


def act(kind, chair=None, cell=None):
    return {"kind": kind, "chair": chair, "cell": cell}


def make_fake_replay(cost=0.01):
    counts: dict[str, int] = {}

    async def replay_fn(request):
        state, chat = (b["text"] for b in request["messages"][0]["content"])
        t = state.split("\n")[0]
        n = counts[t + chat] = counts.get(t + chat, 0) + 1
        if t == "t=2000":  # Sol: flips chair 2 if either copy is visible
            return (act("flip", 2) if "[m1] " in chat or "[m7] " in chat else act("wait")), cost
        if t == "t=4000":  # Sage: moves chair 5 with m2; without it, 2 times out of 5
            return (act("move", 5, [4, 4]) if "[m2] " in chat or n <= 2 else act("wait")), cost
        if t == "t=4600":  # Sol: goes for the proposed cell only with Sam's plan
            return (act("move", 3, [1, 1]) if "[m3] " in chat else act("move", 3, [6, 6])), cost
        if t == "t=6000":  # Sam: without m5 touches chair 6, 3 times out of 5
            return (act("flip", 1) if "[m5] " in chat or n > 3 else act("move", 6, [0, 0])), cost
        raise AssertionError(t)
    return replay_fn


def by_msg(r, mid, to=None):
    return [e for e in r["instructions"] if e["message_id"] == mid and (to is None or e["to"] == to)]


async def test_measure_run_end_to_end_fixture():
    r = await measure_run(events=events(), decisions=DECISIONS, label_fn=label_fn, replay_fn=make_fake_replay(),
                          min_influence=0.5, budget_left_usd=None)
    assert r["measure_version"] == 2
    assert (r["solved"], r["duration_ms"], r["end_reason"]) == (True, 300000, "solved")
    assert r["leader_agent"] == "Sky" and r["richest_agent"] == "Sam" and r["leader_is_richest"] is False
    # copies credited once: m1 + m7 -> one test worth 1.0; m2 0.6; prohibition m5 0.6; Sam's plan 1.0
    assert r["influence"] == {"Sam": 1.0, "Sky": 2.2, "Sol": 0.0, "Sage": 0.0}
    assert r["influence_by_type"]["Sky"] == {"instruction": 1.6, "prohibition": 0.6, "plan": 0.0}
    assert r["influence_by_type"]["Sam"] == {"instruction": 0.0, "prohibition": 0.0, "plan": 1.0}
    assert r["influence_received"] == {"Sam": 0.6, "Sky": 0.0, "Sol": 2.0, "Sage": 0.6}
    assert r["followers"] == {"Sam": ["Sol"], "Sky": ["Sage", "Sam", "Sol"], "Sol": [], "Sage": []}
    assert r["influence_share"] == {"Sam": 0.3125, "Sky": 0.6875, "Sol": 0.0, "Sage": 0.0}
    assert r["target_agent"] == "Sky" and r["target_share"] == 0.6875
    assert r["share_by_goal"] == {"square": 0.3125, "upside_down": 0.6875, "one_zone": 0.0, "touching": 0.0}
    assert r["measured_leader"] == "Sky" and r["measured_leader_strict"] == "Sky"

    assert by_msg(r, 1)[0] | {} == {"message_id": 1, "from": "Sky", "to": "Sol", "type": "instruction",
                                   "action": act("flip", 2), "actions": [act("flip", 2)], "followed": True,
                                   "p_with": 1.0, "p_without": 0.0,
                                   "score": 1.0, "untested_reason": None}
    assert by_msg(r, 7)[0]["score"] == 1.0  # the copy shows the shared test
    assert by_msg(r, 2)[0]["p_without"] == 0.4 and by_msg(r, 2)[0]["score"] == 0.6
    assert by_msg(r, 9)[0]["followed"] is False and by_msg(r, 9)[0]["score"] == 0.0
    plan = by_msg(r, 3, "Sol")[0]
    assert plan["type"] == "plan" and plan["score"] == 1.0 and plan["action"] == act("move", 3, [1, 1])
    ban = by_msg(r, 5)[0]
    assert ban["type"] == "prohibition" and ban["followed"] is True and (ban["p_with"], ban["p_without"]) == (0.0, 0.6)
    assert by_msg(r, 8)[0]["score"] is None and by_msg(r, 8)[0]["untested_reason"] == "message_not_seen"
    assert r["tests"] == {"run": 4, "entries_scored": 6, "untested": {"message_not_seen": 1}}
    assert r["styles"]["3"] == "non_directive" and r["style_mix"]["Sky"]["directive"] == 6
    assert r["invalid_share"] == 0.2 and r["partial"] is False
    assert r["measure_cost_usd"] == round(8 * 0.001 + 4 * 10 * 0.01, 6)


async def test_decision_asked_before_the_message_does_not_count():
    # Sol's decision was requested before m1 arrived, so it cannot be a follow; the next one that saw m1 is.
    msgs = [(1, 1000, "Sky", "Sol, flip chair 2")]
    decisions = [decision("Sol", 1, 900, "flip", 2, msgs=msgs), decision("Sol", 2, 1600, "flip", 2, msgs=msgs)]
    decisions[0]["t_ms"] = 1100  # applied after the message, but its request did not contain it

    async def labels(sender, text, agents):
        return LABELS[1], 0.0

    async def replay(request):
        return (act("flip", 2) if "[m1] " in request["messages"][0]["content"][1]["text"] else act("wait")), 0.0

    ev = [e for e in events() if e["type"] != "message"] + [
        {"seq": 2, "t": 1000, "type": "message", "data": {"agent": "Sky", "id": 1, "text": "Sol, flip chair 2"}}]
    r = await measure_run(events=ev, decisions=decisions, label_fn=labels, replay_fn=replay, min_influence=0.5,
                          budget_left_usd=None)
    e = r["instructions"][0]
    assert e["followed"] is True and e["score"] == 1.0
    assert r["measured_leader"] == "Sky" and r["measured_leader_strict"] is None  # one follower: lenient rule only


async def test_group_instruction_tests_each_recipient():
    async def labels(sender, text, agents):
        if text.startswith("Sol, flip chair 2"):
            return MessageLabel(style="directive", instructions=[ins(["Sol", "Sage", "Sky"], "flip", 2)]), 0.0
        return MessageLabel(style="other"), 0.0

    r = await measure_run(events=events(), decisions=DECISIONS, label_fn=labels, replay_fn=make_fake_replay(),
                          min_influence=0.5, budget_left_usd=None)
    m1 = by_msg(r, 1)
    assert [e["to"] for e in m1] == ["Sol", "Sage"]  # the sender itself is dropped
    assert m1[0]["score"] == 1.0 and m1[1]["followed"] is False  # Sage moved chair 5 instead


async def test_requests_to_one_agent_merge_and_group_bans_are_dropped():
    async def labels(sender, text, agents):
        if text == "Sage, move chair 5 to [4,4]":  # Sol-style message: four chairs for Sage, plus a ban for everyone
            return MessageLabel(style="directive", instructions=[
                ins(["Sage"], "move", 3), ins(["Sage"], "move", 4), ins(["Sage"], "move", 5), ins(["Sage"], "move", 7),
                ins(["Sam", "Sol", "Sage"], "avoid", 1),
            ]), 0.0
        return MessageLabel(style="other"), 0.0

    r = await measure_run(events=events(), decisions=DECISIONS, label_fn=labels, replay_fn=make_fake_replay(),
                          min_influence=0.5, budget_left_usd=None)
    m2 = by_msg(r, 2)
    assert len(m2) == 1 and m2[0]["type"] == "instruction"  # one entry for Sage, no entry for the group ban
    assert [a["chair"] for a in m2[0]["actions"]] == [3, 4, 5, 7]
    assert m2[0]["followed"] is True and m2[0]["action"] == act("move", 5, [4, 4])  # chair 5 was done: followed
    assert r["tests"]["run"] == 1 and m2[0]["score"] == 0.6


async def test_untestable_is_missing_not_zero():
    async def failing(request):
        return None, 0.0

    r = await measure_run(events=events(), decisions=DECISIONS, label_fn=label_fn, replay_fn=failing,
                          min_influence=0.5, budget_left_usd=None)
    scored = [e for e in r["instructions"] if e["followed"] and e["type"] == "instruction"]
    assert scored and all(e["score"] is None and e["untested_reason"] == "replay_failed" for e in scored)
    assert r["influence_share"] == {"Sam": None, "Sky": None, "Sol": None, "Sage": None}  # nothing measured
    assert r["target_share"] is None and r["measured_leader"] is None
    assert r["tests"]["untested"] == {"replay_failed": 5, "message_not_seen": 1}


async def test_unnamed_or_self_instruction_ignored():
    calls = []

    async def replay_fn(request):
        calls.append(request)
        return None, 0.0

    async def self_or_unknown(sender, text, agents):
        return MessageLabel(style="directive", instructions=[ins([sender, "someone"], "flip", 2)]), 0.0

    r = await measure_run(events=events(), decisions=DECISIONS, label_fn=self_or_unknown, replay_fn=replay_fn,
                          min_influence=0.5, budget_left_usd=None)
    assert r["instructions"] == [] and calls == [] and r["measured_leader"] is None


async def test_partial_when_budget_exceeded():
    r = await measure_run(events=events(), decisions=DECISIONS, label_fn=label_fn, replay_fn=make_fake_replay(cost=1.0),
                          min_influence=0.5, budget_left_usd=2.0)
    assert r["partial"] is True
    assert r["measure_cost_usd"] <= 2.0 + 4 * 1.0  # at most the in-flight calls overshoot
    assert "over_budget" in r["tests"]["untested"]
    assert r["measured_leader"] is None


async def test_replay_adapter_converts_decision():
    class D:
        action, chair, x, y = "move", 3, 1, 2

    class Res:
        decision, cost_usd = D(), 0.5

    async def call_decision(client, request, effort):
        assert effort == "low"
        return Res()

    assert await make_replay_fn(call_decision, None, "low")({}) == ({"kind": "move", "chair": 3, "cell": [1, 2]}, 0.5)


async def test_label_message_call_shape():
    from types import SimpleNamespace

    from app.measure.label import label_message

    seen = {}

    async def parse(**kw):
        seen.update(kw)
        return SimpleNamespace(usage=SimpleNamespace(input_tokens=1_000_000, output_tokens=0), parsed_output=LABELS[1])

    client = SimpleNamespace(messages=SimpleNamespace(parse=parse))
    label, cost = await label_message(client, "claude-haiku-5-5", "Sky", "Sol, flip chair 2", ["Sam", "Sky", "Sol", "Sage"], "low")
    assert label == LABELS[1] and cost == 0.10
    assert seen["output_format"] is MessageLabel and seen["output_config"] == {"effort": "low"} and "temperature" not in seen
    assert "Sender: Sky" in seen["messages"][0]["content"]
