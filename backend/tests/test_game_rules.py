from app.game.board import AGENTS, GOALS, in_grid
from app.game.goals import goals_met
from app.game.layouts import make_layout, rich_agent, roles
from app.game.solver import PLACEMENTS, actions_left, completion, min_actions


def chairs(cells, upside=False):
    return [{"cell": c, "upside_down": upside} for c in cells]


RING = [(4, 4), (5, 4), (6, 4), (4, 5), (6, 5), (4, 6), (5, 6), (6, 6)]


def test_goals_ring_detected():
    assert goals_met(chairs(RING, upside=True)) == {"square": True, "upside_down": True, "one_zone": True, "touching": True}
    assert goals_met(chairs(RING))["upside_down"] is False


def test_goals_2x4_block_not_circle():
    met = goals_met(chairs([(x, y) for y in (0, 1) for x in range(4)]))
    assert met == {"square": False, "upside_down": False, "one_zone": True, "touching": True}


def test_zone_and_touching_checks():
    # ring straddling zones 0 and 1: square + touching, but not one zone
    straddle = [(x + 2, y) for x, y in [(0, 0), (1, 0), (2, 0), (0, 1), (2, 1), (0, 2), (1, 2), (2, 2)]]
    met = goals_met(chairs(straddle))
    assert met["square"] and met["touching"] and not met["one_zone"]
    # two separate pairs in one zone: one zone, not touching
    met = goals_met(chairs([(0, 0), (1, 0), (3, 3), (3, 2)]))
    assert met["one_zone"] and not met["touching"] and not met["square"]
    # diagonal does not count as touching
    assert not goals_met(chairs([(0, 0), (1, 1)]))["touching"]


def test_solver_counts_in_place_chairs():
    assert len(PLACEMENTS) == 16
    assert min_actions(RING) == 8
    assert min_actions(RING[:2] + [(0, 0), (3, 3), (7, 0), (4, 3), (0, 7), (3, 4)]) == 14


def test_zone_goal_names_one_zone():
    assert goals_met(chairs(RING), target_zone=3)["one_zone"] is True
    assert goals_met(chairs(RING), target_zone=0)["one_zone"] is False
    assert min_actions(RING, zone=3) == 8 and min_actions(RING, zone=0) == 16


def test_actions_left_and_completion():
    assert actions_left(chairs(RING, upside=True), 3) == 0
    assert actions_left(chairs(RING), 3) == 8  # flips only
    assert actions_left(chairs(RING), 0) == 16  # whole ring in the wrong zone
    assert completion(chairs(RING), 16, 3) == 0.5 and completion(chairs(RING), 4, 0) == 0.0


def test_layout_deterministic_and_seed_only_changes_names():
    a = make_layout(7, [9, 5, 3, 3], seed=1)
    assert make_layout(7, [9, 5, 3, 3], seed=1) == a
    assert make_layout(8, [9, 5, 3, 3], seed=1) != a
    b = next(make_layout(7, [9, 5, 3, 3], seed=s) for s in range(2, 50)
             if make_layout(7, [9, 5, 3, 3], seed=s).agents[0][0] != a.agents[0][0])
    assert b.chairs == a.chairs and b.zone == a.zone and b.min_actions == a.min_actions
    by_goal = lambda lay: {g: (lay.budgets[n], dict(lay.agents)[n], n == lay.leader) for n, g in lay.goals.items()}
    assert by_goal(a) == by_goal(b)  # same goal -> same budget, start cell and leader role, whatever the name


def test_roles_rotate_over_layouts():
    pairs = [roles(n) for n in range(1, 17)]
    assert len(set(pairs)) == 16  # every (leader goal, rich goal) pair once
    assert [p[0] for p in pairs[:4]] == GOALS and all(p[0] != p[1] for p in pairs[:12])
    lay = make_layout(5, [9, 5, 3, 3], seed=3)
    leader_goal, rich_goal = roles(5)
    assert lay.goals[lay.leader] == leader_goal
    assert lay.goals[max(lay.budgets, key=lay.budgets.get)] == rich_goal


def test_rich_agent_matches_layout():
    for n, seed in [(1, 7), (5, 3), (14, 123456)]:
        lay = make_layout(n, [9, 5, 3, 3], seed)
        assert rich_agent(n, [3, 9, 5, 3], seed) == max(lay.budgets, key=lay.budgets.get)
    assert rich_agent(1, [6, 6, 6, 6], 7) is None and rich_agent(1, [9, 9, 3, 3], 7) is None

def test_layouts_1_to_200_in_14_16_range():
    for n in range(1, 201):
        lay = make_layout(n, [9, 5, 3, 3], seed=n)
        assert 14 <= lay.min_actions <= 16 and lay.zone in range(4)
        cells = [c for _, c in lay.chairs]
        assert len(set(cells)) == 8 and all(in_grid(c) for c in cells)
        assert [i for i, _ in lay.chairs] == list(range(1, 9))
        assert sorted(name for name, _ in lay.agents) == sorted(AGENTS)
        assert sorted(lay.goals.values()) == sorted(GOALS)
        assert sorted(lay.budgets.values()) == [3, 3, 5, 9]
        assert lay.leader in AGENTS
