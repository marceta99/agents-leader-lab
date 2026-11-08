from app.measure.label import Instruction, MessageLabel
from app.measure.run import make_replay_fn, measure_run

AGENTS = [("Sam", 9, False), ("Sky", 5, True), ("Sol", 3, False), ("Sage", 3, False)]
MSGS = [  # (id, t, sender, text)
    (1, 1000, "Sky", "Sol, flip chair 2"),
    (2, 3000, "Sky", "Sage, move chair 5 to [4,4]"),
    (3, 3500, "Sam", "What if we build the ring in the top-left?"),
    (4, 5000, "Sol", "someone flip chair 1"),
]
LABELS = {
    1: MessageLabel(style="directive", instruction=Instruction(to="Sol", kind="flip", chair=2)),
    2: MessageLabel(style="directive", instruction=Instruction(to="Sage", kind="move", chair=5, x=4, y=4)),
    3: MessageLabel(style="non_directive"),
    4: MessageLabel(style="other"),
}


def events():
    ev = [{"seq": 1, "t": 0, "type": "run_started", "data": {"agents": [
        {"name": n, "cell": [0, 0], "goal": "circle", "budget": b, "is_leader": lead, "leader_style": "directive" if lead else None}
        for n, b, lead in AGENTS]}}]
    ev += [{"seq": i + 2, "t": t, "type": "message", "data": {"agent": a, "id": mid, "text": txt}} for i, (mid, t, a, txt) in enumerate(MSGS)]
    met = {"circle": True, "upside_down": True, "one_zone": True, "touching": True}
    ev.append({"seq": 9, "t": 300000, "type": "run_ended", "data": {"reason": "solved", "solved": True, "met": met, "duration_ms": 300000}})
    return ev


def request_at(t, agent):
    lines = [f"[m{mid}] {a}: {txt}" for mid, mt, a, txt in MSGS if mt < t]
    chat = "Chat so far:\n" + ("\n".join(lines) or "(none)")
    return {"model": "m", "system": f"You are {agent}.", "messages": [{"role": "user", "content": [
        {"type": "text", "text": "state"}, {"type": "text", "text": chat}]}]}


def decision(agent, seq, t, kind, chair=None, cell=None, outcome="ok"):
    return {"agent": agent, "seq": seq, "t_ms": t, "trigger": [], "request": request_at(t, agent), "response": {},
            "action": {"kind": kind, "chair": chair, "cell": cell}, "outcome": outcome}


DECISIONS = [
    decision("Sol", 1, 2000, "flip", 2),
    decision("Sage", 1, 4000, "move", 5, [4, 4]),
    decision("Sam", 1, 4500, "wait", outcome="skipped_invalid"),
    decision("Sam", 2, 6000, "flip", 1),
]


async def label_fn(sender, text, agents):
    mid = next(m for m, _, _, txt in MSGS if txt == text)
    return LABELS[mid], 0.001


def make_fake_replay(cost=0.01):
    without_dee_hits = [0]

    async def replay_fn(request):
        chat = request["messages"][0]["content"][1]["text"]
        if request["system"] == "You are Sol.":  # flips chair 2 only when m1 is visible
            return ({"kind": "flip", "chair": 2, "cell": None} if "[m1] " in chat else {"kind": "wait", "chair": None, "cell": None}), cost
        if "[m2] " in chat:
            return {"kind": "move", "chair": 5, "cell": [4, 4]}, cost
        without_dee_hits[0] += 1  # Sage without m2: does it once out of 3 anyway
        return ({"kind": "move", "chair": 5, "cell": [4, 4]} if without_dee_hits[0] == 1 else None), cost
    return replay_fn


async def test_measure_run_end_to_end_fixture():
    r = await measure_run(events=events(), decisions=DECISIONS, label_fn=label_fn, replay_fn=make_fake_replay(),
                          min_influence=0.5, budget_left_usd=None)
    assert (r["solved"], r["duration_ms"], r["end_reason"]) == (True, 300000, "solved")
    assert r["goals_met"]["circle"] is True
    assert r["leader_agent"] == "Sky" and r["richest_agent"] == "Sam" and r["leader_is_richest"] is False
    assert r["measured_leader"] == "Sky"
    assert r["influence"] == {"Sam": 0.0, "Sky": 1.6667, "Sol": 0.0, "Sage": 0.0}
    assert r["influence_received"] == {"Sam": 0.0, "Sky": 0.0, "Sol": 1.0, "Sage": 0.6667}
    assert r["influence_share"] == {"Sam": 0.0, "Sky": 1.0, "Sol": 0.0, "Sage": 0.0}
    assert r["instructions"] == [
        {"message_id": 1, "from": "Sky", "to": "Sol", "action": {"kind": "flip", "chair": 2, "cell": None},
         "followed": True, "p_with": 1.0, "p_without": 0.0, "score": 1.0},
        {"message_id": 2, "from": "Sky", "to": "Sage", "action": {"kind": "move", "chair": 5, "cell": [4, 4]},
         "followed": True, "p_with": 1.0, "p_without": 0.3333, "score": 0.6667},
    ]
    assert r["styles"] == {"1": "directive", "2": "directive", "3": "non_directive", "4": "other"}
    assert r["style_mix"]["Sky"] == {"directive": 2, "non_directive": 0, "other": 0}
    assert r["style_mix"]["Sage"] == {"directive": 0, "non_directive": 0, "other": 0}
    assert r["invalid_share"] == 0.25
    assert r["partial"] is False
    assert r["measure_cost_usd"] == round(4 * 0.001 + 12 * 0.01, 6)


async def test_unnamed_instruction_ignored():
    calls = []

    async def no_instruction_labels(sender, text, agents):
        return MessageLabel(style="directive"), 0.0

    async def replay_fn(request):
        calls.append(request)
        return None, 0.0

    r = await measure_run(events=events(), decisions=DECISIONS, label_fn=no_instruction_labels, replay_fn=replay_fn,
                          min_influence=0.5, budget_left_usd=None)
    assert r["instructions"] == [] and calls == [] and r["measured_leader"] is None

    async def self_or_unknown(sender, text, agents):  # recipient = sender, or not an agent of this run
        return MessageLabel(style="directive", instruction=Instruction(to=sender if "Sol" in text else "someone", kind="flip", chair=2)), 0.0

    r = await measure_run(events=events(), decisions=DECISIONS, label_fn=self_or_unknown, replay_fn=replay_fn,
                          min_influence=0.5, budget_left_usd=None)
    assert r["instructions"] == [] and calls == []


async def test_partial_when_budget_exceeded():
    r = await measure_run(events=events(), decisions=DECISIONS, label_fn=label_fn, replay_fn=make_fake_replay(cost=1.0),
                          min_influence=0.5, budget_left_usd=2.0)
    assert r["partial"] is True
    assert r["measure_cost_usd"] <= 2.0 + 4 * 1.0  # at most the in-flight calls overshoot
    assert all(i["score"] == 0.0 for i in r["instructions"])
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
