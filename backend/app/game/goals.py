"""The four goal checks. `chairs` is any iterable of dicts with "cell" and "upside_down"."""

from app.game.board import neighbours, zone


def _connected(cells: set) -> bool:
    if not cells:
        return True
    start = next(iter(cells))
    seen, stack = {start}, [start]
    while stack:
        for n in neighbours(stack.pop()):
            if n in cells and n not in seen:
                seen.add(n)
                stack.append(n)
    return len(seen) == len(cells)


def goals_met(chairs, target_zone: int | None = None) -> dict[str, bool]:
    """target_zone: the zone the one_zone goal names (None = any single zone)."""
    chairs = list(chairs)
    cells = [tuple(c["cell"]) for c in chairs]
    cellset = set(cells)
    touching = _connected(cellset)
    square = (
        len(cellset) == len(cells)
        and touching
        and all(sum(n in cellset for n in neighbours(c)) == 2 for c in cells)
    )
    return {
        "square": square,
        "upside_down": all(c["upside_down"] for c in chairs),
        "one_zone": ({zone(c) for c in cells} == {target_zone}) if target_zone is not None
        else len({zone(c) for c in cells}) == 1,
        "touching": touching,
    }
