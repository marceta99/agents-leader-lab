from app.game.board import AGENTS, GOALS, in_grid
from app.game.goals import goals_met
from app.game.layouts import make_layout
from app.game.solver import PLACEMENTS, min_actions


def chairs(cells, upside=False):
    return [{"cell": c, "upside_down": upside} for c in cells]


RING = [(4, 4), (5, 4), (6, 4), (4, 5), (6, 5), (4, 6), (5, 6), (6, 6)]


def test_goals_ring_detected():
    assert goals_met(chairs(RING, upside=True)) == {"circle": True, "upside_down": True, "one_zone": True, "touching": True}
    assert goals_met(chairs(RING))["upside_down"] is False


def test_goals_2x4_block_not_circle():
    met = goals_met(chairs([(x, y) for y in (0, 1) for x in range(4)]))
    assert met == {"circle": False, "upside_down": False, "one_zone": True, "touching": True}


def test_zone_and_touching_checks():
    # ring straddling zones 0 and 1: circle + touching, but not one zone
    straddle = [(x + 2, y) for x, y in [(0, 0), (1, 0), (2, 0), (0, 1), (2, 1), (0, 2), (1, 2), (2, 2)]]
    met = goals_met(chairs(straddle))
    assert met["circle"] and met["touching"] and not met["one_zone"]
    # two separate pairs in one zone: one zone, not touching
    met = goals_met(chairs([(0, 0), (1, 0), (3, 3), (3, 2)]))
    assert met["one_zone"] and not met["touching"] and not met["circle"]
    # diagonal does not count as touching
    assert not goals_met(chairs([(0, 0), (1, 1)]))["touching"]


def test_solver_counts_in_place_chairs():
    assert len(PLACEMENTS) == 16
    assert min_actions(RING) == 8
    assert min_actions(RING[:2] + [(0, 0), (3, 3), (7, 0), (4, 3), (0, 7), (3, 4)]) == 14


def test_layout_deterministic():
    a = make_layout(7, [9, 5, 3, 3])
    make_layout(8, [9, 5, 3, 3])
    assert make_layout(7, [9, 5, 3, 3]) == a
    assert make_layout(8, [9, 5, 3, 3]) != a
    solo = make_layout(7, [9, 5, 3, 3], solo=True)
    assert solo.chairs == a.chairs and solo.agents == [("Ada", a.agents[0][1])]
    assert solo.goals == {"Ada": GOALS} and solo.budgets == {"Ada": 20}


def test_layouts_1_to_200_in_14_16_range():
    for n in range(1, 201):
        lay = make_layout(n, [9, 5, 3, 3])
        assert 14 <= lay.min_actions <= 16
        cells = [c for _, c in lay.chairs]
        assert len(set(cells)) == 8 and all(in_grid(c) for c in cells)
        assert [i for i, _ in lay.chairs] == list(range(1, 9))
        assert [name for name, _ in lay.agents] == AGENTS
        assert sorted(lay.goals.values()) == sorted(GOALS)
        assert sorted(lay.budgets.values()) == [3, 3, 5, 9]
        assert lay.leader in AGENTS
