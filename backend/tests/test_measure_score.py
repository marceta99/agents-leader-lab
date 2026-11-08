from app.measure.label import Instruction
from app.measure.run import remove_chat_line, remove_chat_lines, saw
from app.measure.score import followed, instruction_score, measured_leader, moves_to, shares, touches


def dec(seq, kind, chair=None, cell=None, outcome="ok"):
    return {"agent": "Sky", "seq": seq, "t_ms": seq * 100, "action": {"kind": kind, "chair": chair, "cell": cell},
            "outcome": outcome}


FLIP2 = Instruction(to=["Sky"], kind="flip", chair=2)


def test_followed_within_two_acting_decisions():
    assert followed(FLIP2, [dec(1, "move", 1, [0, 0]), dec(2, "flip", 2)])["seq"] == 2
    assert followed(FLIP2, [dec(1, "move", 1, [0, 0]), dec(2, "flip", 3), dec(3, "flip", 2)]) is None


def test_only_acting_decisions_count():
    ds = [dec(1, "wait"), dec(2, "continue"), dec(3, "flip", 2, outcome="invalid"), dec(4, "move", 1, [0, 0]),
          dec(5, "flip", 2)]
    assert followed(FLIP2, ds)["seq"] == 5


def test_cell_must_match_when_named():
    ins = Instruction(to=["Sky"], kind="move", chair=4, x=3, y=3)
    assert followed(ins, [dec(1, "move", 4, [3, 4])]) is None
    assert followed(ins, [dec(1, "move", 4, [3, 3])])
    assert followed(Instruction(to=["Sky"], kind="move", chair=4), [dec(1, "move", 4, [6, 6])])


def test_touches_and_moves_to():
    assert touches({"kind": "flip", "chair": 6}, 6) and touches({"kind": "move", "chair": 6, "cell": [0, 0]}, 6)
    assert not touches({"kind": "put_down", "chair": 6}, 6) and not touches(None, 6)
    assert moves_to({"kind": "move", "chair": 1, "cell": [2, 2]}, {(2, 2)})
    assert not moves_to({"kind": "flip", "chair": 1, "cell": None}, {(2, 2)})


def test_influence_never_negative():
    assert instruction_score(0.0, 1.0) == 0.0
    assert abs(instruction_score(1.0, 1 / 3) - 2 / 3) < 1e-9


def test_leader_rules():
    one = {"Sam": {"Sky"}}
    two = {"Sam": {"Sky", "Sol"}}
    assert measured_leader({"Sam": 2.0, "Sky": 0.0}, one, 0.5) == "Sam"  # lenient: one follower is enough
    assert measured_leader({"Sam": 2.0, "Sky": 0.0}, one, 0.5, min_followers=2) is None
    assert measured_leader({"Sam": 2.0, "Sky": 0.0}, two, 0.5, min_followers=2) == "Sam"
    assert measured_leader({"Sam": 2.0, "Sky": 0.0}, {}, 0.5) is None  # no follower


def test_leader_needs_margin_over_next_agent():
    f = {"Sam": {"Sky"}, "Sky": {"Sam"}}
    assert measured_leader({"Sam": 1.0, "Sky": 0.67}, f, 0.5) is None  # ahead by 0.33 < 0.5
    assert measured_leader({"Sam": 1.2, "Sky": 0.7}, f, 0.5) == "Sam"  # ahead by exactly 0.5
    assert measured_leader({"Sam": 0.4, "Sky": 0.0}, f, 0.5) is None  # below the minimum


def test_shares():
    s = shares({"Sam": 0.0, "Sky": 1.67, "Sol": 0.0, "Sage": 0.33})
    assert abs(sum(s.values()) - 1.0) < 1e-9
    assert shares({"Sam": 0.0, "Sky": 0.0}) == {"Sam": None, "Sky": None}  # undefined, not 0


def _req(chat):
    return {"model": "m", "system": "s", "messages": [{"role": "user", "content": [
        {"type": "text", "text": "state"}, {"type": "text", "text": chat}]}]}


def test_remove_chat_lines_exact():
    req = _req("Chat so far:\n[m1] Sam: hi\n[m10] Sky: flip chair 2\n[m2] Sol: ok")
    out = remove_chat_line(req, 1)
    assert out["messages"][0]["content"][1]["text"] == "Chat so far:\n[m10] Sky: flip chair 2\n[m2] Sol: ok"
    assert req["messages"][0]["content"][1]["text"].count("\n") == 3  # original untouched
    assert remove_chat_lines(req, [1, 2])["messages"][0]["content"][1]["text"] == "Chat so far:\n[m10] Sky: flip chair 2"
    assert remove_chat_line(_req("Chat so far:\n[m10] Sky: x"), 10)["messages"][0]["content"][1]["text"] == "Chat so far:\n(none)"
    assert remove_chat_line(req, 99) == req


def test_saw_matches_whole_message_id():
    d = {"request": _req("Chat so far:\n[m10] Sky: x")}
    assert saw(d, 10) and not saw(d, 1) and not saw({"request": {}}, 10)
