"""Numbered starting layouts. Same n -> same chairs, start cells, target zone, leader goal and budgets, forever
(bump LAYOUT_VERSION if this changes). Only the names and their order change per run, from the run's seed."""

import random
from dataclasses import dataclass

from app.game.board import AGENTS, GOALS, GRID
from app.game.solver import min_actions as _min_actions

LAYOUT_VERSION = 2
_CELLS = [(x, y) for y in range(GRID) for x in range(GRID)]


@dataclass
class Layout:
    n: int
    chairs: list  # [(id, (x, y))]
    agents: list  # [(name, (x, y))], in the run's shuffled order (the order agents are listed in prompts)
    goals: dict  # name -> goal id
    budgets: dict  # name -> int
    leader: str
    min_actions: int
    zone: int | None = None  # zone the one_zone goal names (None = any zone)


def roles(n: int) -> tuple[str, str]:
    """(leader goal, rich goal) for layout n. The leader goal cycles every layout; the rich goal is offset by
    1, 2, 3, 0 in blocks of 4, so 16 layouts cover each (leader, rich) pair once (leader = rich in 13..16)."""
    i = n - 1
    return GOALS[i % 4], GOALS[(i + i // 4 + 1) % 4]


def make_layout(n: int, budgets: list[int], seed: int = 0) -> Layout:
    # Separate string sub-seeds (deterministic across processes) so each part is independent.
    zone = random.Random(f"layout-{n}-zone").randrange(4)
    rng = random.Random(f"layout-{n}-cells")
    while True:
        chair_cells = rng.sample(_CELLS, 8)
        start_cells = [rng.choice(_CELLS) for _ in GOALS]  # one per goal, in GOALS order
        actions = _min_actions(chair_cells, zone)
        if 14 <= actions <= 16:
            break
    leader_goal, rich_goal = roles(n)
    ranked = sorted(budgets, reverse=True)
    r = GOALS.index(rich_goal)
    budget_by_goal = {GOALS[(r + k) % 4]: ranked[k] for k in range(4)}
    # Per run: which name plays which goal, and the order everyone is listed in.
    run_rng = random.Random(f"run-{seed}")
    names = run_rng.sample(AGENTS, 4)  # names[i] plays GOALS[i]
    order = run_rng.sample(range(4), 4)
    goal_of = dict(zip(names, GOALS))
    agents = [(names[i], start_cells[i]) for i in order]
    return Layout(
        n, [(i + 1, cell) for i, cell in enumerate(chair_cells)], agents,
        {name: goal_of[name] for name, _ in agents}, {name: budget_by_goal[goal_of[name]] for name, _ in agents},
        names[GOALS.index(leader_goal)], actions, zone,
    )
