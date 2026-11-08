from app.measure.label import Instruction
from app.measure.run import remove_chat_line
from app.measure.score import followed, instruction_score, measured_leader, shares


def dec(seq, t, kind, chair=None, cell=None, outcome="ok"):
    return {"agent": "Sky", "seq": seq, "t_ms": t, "action": {"kind": kind, "chair": chair, "cell": cell}, "outcome": outcome}


FLIP2 = Instruction(to="Sky", kind="flip", chair=2)


def test_followed_within_two_decisions():
    ds = [dec(1, 500, "flip", 2), dec(2, 1500, "move", 1, [0, 0]), dec(3, 2000, "flip", 2)]
    ok, d = followed(FLIP2, 1000, ds)
    assert ok and d["seq"] == 3  # decision before the message does not count


def test_not_followed_on_third():
    ds = [dec(1, 1100, "move", 1, [0, 0]), dec(2, 1200, "flip", 3), dec(3, 1300, "flip", 2)]
    assert followed(FLIP2, 1000, ds) == (False, None)


def test_only_acting_decisions_count():
    ds = [dec(1, 1100, "wait"), dec(2, 1200, "continue"), dec(3, 1250, "flip", 2, outcome="invalid"),
          dec(4, 1300, "move", 1, [0, 0]), dec(5, 1400, "flip", 2)]
    ok, d = followed(FLIP2, 1000, ds)
    assert ok and d["seq"] == 5


def test_cell_must_match_when_named():
    ins = Instruction(to="Sky", kind="move", chair=4, x=3, y=3)
    assert not followed(ins, 0, [dec(1, 10, "move", 4, [3, 4])])[0]
    assert followed(ins, 0, [dec(1, 10, "move", 4, [3, 3])])[0]
    assert followed(Instruction(to="Sky", kind="move", chair=4), 0, [dec(1, 10, "move", 4, [6, 6])])[0]


def test_influence_never_negative():
    assert instruction_score(0.0, 1.0) == 0.0
    assert abs(instruction_score(1.0, 1 / 3) - 2 / 3) < 1e-9


def test_leader_requires_two_followers():
    assert measured_leader({"Sam": 2.0, "Sky": 0.0}, {"Sam": {"Sky"}}, 0.5) is None
    assert measured_leader({"Sam": 2.0, "Sky": 0.0}, {"Sam": {"Sky", "Sol"}}, 0.5) == "Sam"


def test_leader_requires_strict_max():
    f = {"Sam": {"Sky", "Sol"}, "Sky": {"Sam", "Sol"}}
    assert measured_leader({"Sam": 1.0, "Sky": 1.0}, f, 0.5) is None
    assert measured_leader({"Sam": 1.0, "Sky": 0.67}, f, 0.5) == "Sam"


def test_no_leader_below_threshold():
    assert measured_leader({"Sam": 0.4, "Sky": 0.0}, {"Sam": {"Sky", "Sol"}}, 0.5) is None


def test_shares_sum_to_one():
    s = shares({"Sam": 0.0, "Sky": 1.67, "Sol": 0.0, "Sage": 0.33})
    assert abs(sum(s.values()) - 1.0) < 1e-9
    assert shares({"Sam": 0.0, "Sky": 0.0}) == {"Sam": 0.0, "Sky": 0.0}


def _req(chat):
    return {"model": "m", "system": "s", "messages": [{"role": "user", "content": [
        {"type": "text", "text": "state"}, {"type": "text", "text": chat}]}]}


def test_remove_chat_line_exact():
    req = _req("Chat so far:\n[m1] Sam: hi\n[m10] Sky: flip chair 2\n[m2] Sol: ok")
    out = remove_chat_line(req, 1)
    assert out["messages"][0]["content"][1]["text"] == "Chat so far:\n[m10] Sky: flip chair 2\n[m2] Sol: ok"
    assert req["messages"][0]["content"][1]["text"].count("\n") == 3  # original untouched
    assert remove_chat_line(_req("Chat so far:\n[m10] Sky: x"), 10)["messages"][0]["content"][1]["text"] == "Chat so far:\n(none)"
    assert remove_chat_line(req, 99) == req
