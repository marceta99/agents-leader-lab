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


def goals_met(chairs) -> dict[str, bool]:
    chairs = list(chairs)
    cells = [tuple(c["cell"]) for c in chairs]
    cellset = set(cells)
    touching = _connected(cellset)
    circle = (
        len(cellset) == len(cells)
        and touching
        and all(sum(n in cellset for n in neighbours(c)) == 2 for c in cells)
    )
    return {
        "circle": circle,
        "upside_down": all(c["upside_down"] for c in chairs),
        "one_zone": len({zone(c) for c in cells}) == 1,
        "touching": touching,
    }
