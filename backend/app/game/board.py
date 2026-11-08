"""Board basics: 8x8 grid, zones, agent names and goals (see docs/contracts.md)."""

GRID = 8
AGENTS = ["Ada", "Bo", "Cy", "Dee"]
GOALS = ["circle", "upside_down", "one_zone", "touching"]
GOAL_TEXT = {
    "circle": "Arrange the chairs in a circle.",
    "upside_down": "Turn all the chairs upside down.",
    "one_zone": "Move all the chairs to one part of the room (one zone).",
    "touching": "Make all the chairs touch each other.",
}


def zone(cell) -> int:
    x, y = cell
    return (y // 4) * 2 + (x // 4)


def in_grid(cell) -> bool:
    return 0 <= cell[0] < GRID and 0 <= cell[1] < GRID


def neighbours(cell) -> list[tuple[int, int]]:
    x, y = cell
    return [c for c in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)) if in_grid(c)]


def distance(a, b) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])
