import json

from app.game.engine import Game, GameConfig
from app.game.layouts import Layout, make_layout
from app.game.scripted import scripted_decision

FAR = [(7, 7), (7, 5), (5, 7), (0, 7), (0, 5), (2, 7)]  # filler chairs, out of the way


def make_game(chairs, agents, budgets=None, seed=0, **cfg):
    """chairs: list of cells (ids 1..), agents: dict name -> cell."""
    names = list(agents)
    lay = Layout(
        n=0, chairs=[(i + 1, c) for i, c in enumerate(chairs)], agents=list(agents.items()),
        goals=dict(zip(names, ["circle", "upside_down", "one_zone", "touching"])),
        budgets=budgets or {n: 5 for n in names}, leader=names[0], min_actions=0,
    )
    game = Game(lay, GameConfig(**cfg), seed=seed)
    game.start()
    return game


def run_to(game, t_end, step=100):
    t = game.t
    while t < t_end and not game.ended:
        t += step
        game.tick(t)


def types(game):
    return [e["type"] for e in game.events]


def play_bots(game, step=100):
    """Fake-time runner loop with scripted bots."""
    game.start()
    t = 0
    while not game.ended:
        game.tick(t)
        for name in game.agents:
            if not game.ended and game.wants_call(name, t):
                game.take_triggers(name)
                game.observation(name)
                kind, chair, cell, msg = scripted_decision(game, name)
                if msg:
                    game.say(name, msg)
                game.decide(name, kind, chair, cell)
                game.record_decision(name, kind, t)
        t += step


def test_first_arrival_takes_chair():
    g = make_game([(3, 0)] + FAR, {"Sam": (0, 0), "Sky": (7, 0)})
    assert g.decide("Sam", "move", 1, [3, 3]) == ("ok", None)
    run_to(g, 100)
    assert g.decide("Sky", "move", 1, [3, 3]) == ("ok", None)
    run_to(g, 6000)  # Sam arrives at 6000, Sky would at 8100
    assert g.chairs[1]["held_by"] == "Sam" and g.agents["Sam"]["budget"] == 4
    assert g.agents["Sky"]["state"] == "idle" and g.agents["Sky"]["budget"] == 5
    assert "Sam took chair 1, which you were heading for." in g.take_triggers("Sky")
    stopped = [e for e in g.events if e["type"] == "agent_stopped"]
    assert stopped[-1]["data"] == {"agent": "Sky", "cell": [5, 0], "reason": "chair_taken"}


def winner(seed):
    g = make_game([(3, 0)] + FAR, {"Sam": (1, 0), "Sky": (5, 0)}, seed=seed)
    g.decide("Sam", "flip", 1)
    g.decide("Sky", "flip", 1)
    run_to(g, 4000)  # both arrive at exactly 4000
    return g.chairs[1]["held_by"]


def test_tie_random_but_seeded():
    winners = [winner(s) for s in range(20)]
    assert winners == [winner(s) for s in range(20)]
    assert set(winners) == {"Sam", "Sky"}


def test_drop_on_occupied_cell_keeps_chair():
    g = make_game([(0, 0), (3, 2)] + FAR, {"Sam": (0, 0), "Sky": (3, 2)})
    g.decide("Sam", "move", 1, [3, 0])  # arrives at 6000
    g.decide("Sky", "move", 2, [3, 0])  # arrives at 4000 and drops
    run_to(g, 6000)
    ada = g.agents["Sam"]
    assert ada["holding"] == 1 and ada["state"] == "idle" and ada["cell"] == (3, 0) and ada["budget"] == 4
    assert "Cell (3, 0) already has a chair, so you are still holding chair 1." in g.take_triggers("Sam")
    assert "agent_stopped" in types(g)
    assert g.decide("Sam", "put_down")[0] == "invalid"
    assert g.decide("Sam", "move", 1, [4, 0]) == ("ok", None)
    run_to(g, 8000)
    assert g.chairs[1]["cell"] == (4, 0) and g.chairs[1]["held_by"] is None
    assert ada["budget"] == 4  # carrying an already-held chair is free


def test_budget_charged_on_take_not_on_order():
    g = make_game([(2, 0)] + FAR, {"Sam": (0, 0)})
    g.decide("Sam", "move", 1, [2, 2])
    assert g.observation("Sam")["you"]["budget_left"] == 5
    run_to(g, 3900)
    assert g.agents["Sam"]["budget"] == 5
    run_to(g, 4000)
    assert g.agents["Sam"]["budget"] == 4
    taken = [e for e in g.events if e["type"] == "chair_taken"]
    assert taken[0]["t"] == 4000 and taken[0]["data"] == {"agent": "Sam", "chair": 1, "for": "move", "budget_left": 4}
    run_to(g, 8000)
    steps = [e for e in g.events if e["type"] == "agent_step"]
    assert [(e["t"], e["data"]["to"]) for e in steps] == [(0, [1, 0]), (2000, [2, 0]), (4000, [2, 1]), (6000, [2, 2])]


def test_zero_budget_can_put_down():
    g = make_game([(0, 0), (2, 1)] + FAR, {"Sam": (0, 0), "Sky": (2, 1)}, budgets={"Sam": 1, "Sky": 5})
    g.decide("Sky", "move", 2, [2, 0])  # Sky drops on (2, 0) at 2000
    g.decide("Sam", "move", 1, [2, 0])  # Sam arrives at 4000: occupied, keeps chair 1 with 0 budget
    run_to(g, 4000)
    assert g.agents["Sam"]["holding"] == 1 and g.agents["Sam"]["budget"] == 0
    assert g.decide("Sam", "flip", 2) == ("invalid", "You have no actions left.")
    assert g.decide("Sam", "move", 2, [5, 5])[0] == "invalid"
    assert g.decide("Sky", "move", 2, [3, 0]) == ("ok", None)  # Sky lifts chair 2 off (2, 0)
    assert g.decide("Sam", "put_down") == ("ok", None)
    assert g.chairs[1]["cell"] == (2, 0) and g.chairs[1]["held_by"] is None
    assert g.decide("Sam", "put_down") == ("invalid", "You are not holding a chair.")


def test_flip_locks_chair():
    g = make_game([(0, 0)] + FAR, {"Sam": (0, 0), "Sky": (1, 0)}, flip_ms=5000)
    g.decide("Sam", "flip", 1)  # Sam is on the chair: takes it at once
    assert g.chairs[1]["held_by"] == "Sam" and g.is_busy("Sam")
    g.take_triggers("Sky")
    g.decide("Sky", "move", 1, [3, 3])  # arrives at 2000, chair still locked
    run_to(g, 2000)
    assert g.agents["Sky"]["state"] == "idle" and g.agents["Sky"]["budget"] == 5
    assert "Sam has chair 1, so you could not take it." in g.take_triggers("Sky")
    assert g.chairs[1]["cell"] == (0, 0) and not g.chairs[1]["upside_down"]
    run_to(g, 5000)
    assert g.chairs[1]["upside_down"] and g.chairs[1]["held_by"] is None and not g.is_busy("Sam")
    assert g.agents["Sam"]["budget"] == 4
    assert "Sam finished flipping chair 1. It is now upside down." in g.take_triggers("Sky")
    assert [e["data"] for e in g.events if e["type"] == "flip_done"] == [{"agent": "Sam", "chair": 1, "upside_down": True}]


def test_target_taken_stops_walker():
    g = make_game([(2, 0)] + FAR, {"Sam": (2, 1), "Sky": (6, 0)})
    run_to(g, 500)
    g.decide("Sky", "move", 1, [0, 0])  # first step would end at 2500
    run_to(g, 1000)
    g.decide("Sam", "flip", 1)  # Sam arrives and takes it at 3000
    run_to(g, 3000)
    bo = g.agents["Sky"]
    assert bo["state"] == "idle" and bo["plan"] is None and bo["budget"] == 5
    assert "Sam took chair 1, which you were heading for." in g.take_triggers("Sky")
    assert [e["data"] for e in g.events if e["type"] == "agent_stopped"] == [{"agent": "Sky", "cell": [5, 0], "reason": "chair_taken"}]
    assert g.decide("Sky", "move", 2, [4, 4]) == ("ok", None)


def test_busy_ignores_new_action():
    g = make_game([(5, 0)] + FAR, {"Sam": (0, 0)})
    g.decide("Sam", "move", 1, [5, 1])
    plan = dict(g.agents["Sam"]["plan"])
    assert g.decide("Sam", "flip", 2)[0] == "ignored_busy"
    assert g.decide("Sam", "wait")[0] == "ignored_busy"
    assert g.decide("Sam", "put_down")[0] == "ignored_busy"
    assert g.decide("Sam", "continue") == ("ok", None)
    assert g.agents["Sam"]["plan"] == plan
    assert g.observation("Sam")["you"]["heading"] == {"kind": "move", "chair": 1, "cell": [5, 1]}


def test_invalid_decisions_change_nothing():
    g = make_game([(1, 0), (2, 0)] + FAR, {"Sam": (0, 0)})
    n = len(g.events)
    assert g.decide("Sam", "move", 99, [1, 1])[0] == "invalid"
    assert g.decide("Sam", "move", 1, [8, 0])[0] == "invalid"
    assert g.decide("Sam", "move", 1, [2, 0]) == ("invalid", "Cell (2, 0) already has chair 2.")
    assert g.decide("Sam", "dance")[0] == "invalid"
    assert len(g.events) == n and not g.is_busy("Sam")


def test_observation_hides_private_fields():
    g = make_game([(5, 0)] + FAR, {"Sam": (0, 0), "Sky": (1, 1), "Sol": (2, 2), "Sage": (3, 3)},
                  budgets={"Sam": 9, "Sky": 5, "Sol": 3, "Sage": 3}, leader="Sam", leader_style="directive")
    g.set_notes("Sam", "secret plan xyz")
    g.decide("Sam", "move", 1, [6, 6])
    obs = g.observation("Sky")
    assert obs["you"]["budget_left"] == 5 and obs["you"]["goal"] == "upside_down"
    for o in obs["others"]:
        assert set(o) == {"name", "cell", "holding", "budget_left", "goal"} and o["goal"] is None
    assert [o["budget_left"] for o in obs["others"]] == [9, 3, 3]  # everyone's actions are visible
    text = json.dumps(obs)
    for leak in ("secret plan", "leader", "directive", "heading\": {", "[6, 6]"):
        assert leak not in text
    g2 = make_game([(5, 0)] + FAR, {"Sam": (0, 0), "Sky": (1, 1)}, know_all_goals=True)
    assert g2.observation("Sky")["others"][0]["goal"] == "circle"


def test_all_waiting_end():
    g = make_game([(5, 0)] + FAR, {"Sam": (0, 0), "Sky": (1, 1)})
    for name in g.agents:
        g.take_triggers(name)
        g.decide(name, "wait")
        g.record_decision(name, "wait", 0)
    run_to(g, 9900)
    assert g.ended is None
    run_to(g, 10000)
    assert g.ended == "all_waiting" and g.events[-1]["type"] == "run_ended"


def test_time_limit_and_budget_exhausted():
    g = make_game([(5, 0)] + FAR, {"Sam": (0, 0)})
    g.tick(10**7)  # big jump, nobody decided
    assert g.ended == "time_limit" and g.events[-1]["data"]["duration_ms"] == 600_000
    g = make_game([(0, 0)] + FAR, {"Sam": (0, 0)}, budgets={"Sam": 1})
    g.decide("Sam", "flip", 1)
    g.tick(5000)
    assert g.ended == "budget_exhausted"


def test_scripted_team_solves_layouts_1_to_20():
    for n in range(1, 21):
        lay = make_layout(n, [5, 5, 5, 5])
        g = Game(lay, GameConfig(), seed=n)
        play_bots(g)
        assert g.ended == "solved", (n, g.ended)
        assert g.events[-1]["data"]["duration_ms"] <= 600_000
        spent = sum(lay.budgets.values()) - sum(a["budget"] for a in g.agents.values())
        assert spent == lay.min_actions, n
        assert g.chat


def test_completion_counts_actions_left():
    lay = make_layout(1, [6, 6, 6, 6])
    g = Game(lay, GameConfig(), seed=1)
    g.start()
    g.end("time_limit")
    assert g.events[-1]["data"]["completion"] == 0.0  # nothing done yet
    g = Game(lay, GameConfig(), seed=1)
    play_bots(g)
    assert g.events[-1]["data"]["completion"] == 1.0


def test_events_seq_contiguous_and_json_serialisable():
    g = Game(make_layout(1, [5, 5, 5, 5]), GameConfig(), seed=1)
    play_bots(g)
    ev = g.events
    assert [e["seq"] for e in ev] == list(range(1, len(ev) + 1))
    assert all(a["t"] <= b["t"] for a, b in zip(ev, ev[1:]))
    assert ev[0]["type"] == "run_started" and ev[1]["type"] == "goals" and ev[-1]["type"] == "run_ended"
    assert ev[-1]["data"]["solved"] is True and all(ev[-1]["data"]["met"].values())
    assert json.loads(json.dumps(ev)) == ev  # no tuples, all JSON types
    assert g.drain_events() == ev and g.drain_events() == []
