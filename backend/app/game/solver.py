"""Minimum actions: every chair flips once, plus every chair not already on the best ring must move."""


def _ring(left: int, top: int) -> list[tuple[int, int]]:
    return [(left + dx, top + dy) for dy in range(3) for dx in range(3) if (dx, dy) != (1, 1)]


# 16 placements of a 3x3 ring (empty centre) fully inside one 4x4 zone: 4 zones x 4 offsets.
PLACEMENTS = [
    _ring(zx * 4 + ox, zy * 4 + oy) for zy in (0, 1) for zx in (0, 1) for oy in (0, 1) for ox in (0, 1)
]


def solve(cells) -> tuple[int, list[tuple[int, int]]]:
    """(min_actions, ring cells of the best placement) for chairs on `cells` (all on their legs)."""
    cells = {tuple(c) for c in cells}
    best = max(PLACEMENTS, key=lambda ring: sum(c in cells for c in ring))
    in_place = sum(c in cells for c in best)
    return len(cells) + len(cells) - in_place, best


def min_actions(cells) -> int:
    return solve(cells)[0]
