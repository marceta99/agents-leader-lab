"""Numbered starting layouts. Same n -> same layout, forever (bump LAYOUT_VERSION if this changes)."""

import random
from dataclasses import dataclass

from app.game.board import AGENTS, GOALS, GRID
from app.game.solver import min_actions as _min_actions

LAYOUT_VERSION = 1
_CELLS = [(x, y) for y in range(GRID) for x in range(GRID)]


@dataclass
class Layout:
    n: int
    chairs: list  # [(id, (x, y))]
    agents: list  # [(name, (x, y))]
    goals: dict  # name -> goal id (solo: name -> list of all goal ids)
    budgets: dict  # name -> int
    leader: str
    min_actions: int


def make_layout(n: int, budgets: list[int], solo: bool = False) -> Layout:
    # Separate string sub-seeds (deterministic across processes) so each part is independent.
    rng = random.Random(f"layout-{n}-cells")
    while True:
        chair_cells = rng.sample(_CELLS, 8)
        agent_cells = [rng.choice(_CELLS) for _ in AGENTS]
        actions = _min_actions(chair_cells)
        if 14 <= actions <= 16:
            break
    goals = random.Random(f"layout-{n}-goals").sample(GOALS, len(GOALS))
    dealt = list(budgets)
    random.Random(f"layout-{n}-budgets").shuffle(dealt)
    leader = random.Random(f"layout-{n}-leader").choice(AGENTS)
    chairs = [(i + 1, cell) for i, cell in enumerate(chair_cells)]
    if solo:
        return Layout(n, chairs, [("Ada", agent_cells[0])], {"Ada": list(GOALS)}, {"Ada": sum(budgets)}, "Ada", actions)
    return Layout(
        n, chairs, list(zip(AGENTS, agent_cells)), dict(zip(AGENTS, goals)), dict(zip(AGENTS, dealt)), leader, actions
    )
