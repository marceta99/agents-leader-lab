"""Board basics: 8x8 grid, zones, agent names and goals (see docs/contracts.md)."""

GRID = 8
AGENTS = ["Sam", "Sky", "Sol", "Sage"]  # short, gender-neutral; shuffled onto goals per run (layouts.py)
GOALS = ["circle", "upside_down", "one_zone", "touching"]
ZONE_NAMES = ["top-left", "top-right", "bottom-left", "bottom-right"]


def goal_text(goal: str, zone: int | None = None) -> str:
    if goal == "one_zone":
        if zone is None:
            return "Move all the chairs to one part of the room (one zone)."
        return f"Move all the chairs to zone {zone} (the {ZONE_NAMES[zone]} part of the room)."
    return {
        "circle": "Arrange the chairs in a circle.",
        "upside_down": "Turn all the chairs upside down.",
        "touching": "Make all the chairs touch each other.",
    }[goal]


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
