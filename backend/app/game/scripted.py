"""Scripted bots: near-perfect play for tests and the dev viewer (no LLM, no API key).

Every bot works towards the same ring (the solver's best placement for the starting chairs).
Bots share a claim table per game, so two bots never go for the same chair or ring cell.
"""

import weakref

from app.game.board import distance
from app.game.solver import solve

_state = weakref.WeakKeyDictionary()  # game -> {"ring": [...], "claims": {agent: (chair, cell | None)}}


def _nearest(cells, origin):
    return min(cells, key=lambda c: (distance(c, origin), c))


def scripted_decision(game, agent: str) -> tuple[str, int | None, list | None, str | None]:
    """(kind, chair, cell, message | None) for `agent`, to pass to game.decide / game.say."""
    s = _state.get(game)
    if s is None:
        s = _state[game] = {"ring": solve([ch["cell"] for ch in game.chairs.values()])[1], "claims": {}}
    if game.is_busy(agent):
        return "continue", None, None, None
    ring, claims = s["ring"], s["claims"]
    claims.pop(agent, None)  # idle again: our previous job is finished (or was interrupted)
    a = game.agents[agent]
    claimed_chairs = {c for c, _ in claims.values()}
    claimed_cells = {cell for _, cell in claims.values() if cell}
    free_ring = [c for c in ring if c not in claimed_cells and game.chair_on(c) is None]

    if a["holding"] is not None:  # e.g. our drop cell was taken: carry the chair to a free ring cell
        if not free_ring:
            return "wait", None, None, None
        cell = _nearest(free_ring, a["cell"])
        claims[agent] = (a["holding"], cell)
        return "move", a["holding"], list(cell), None
    if a["budget"] == 0:
        return "wait", None, None, None

    options = []
    for cid, ch in game.chairs.items():
        if ch["held_by"] or cid in claimed_chairs or (ch["cell"] in ring and ch["upside_down"]):
            continue
        if ch["cell"] in ring:
            options.append((distance(a["cell"], ch["cell"]), cid, None))
        elif free_ring:
            options.append((distance(a["cell"], ch["cell"]), cid, _nearest(free_ring, ch["cell"])))
    if not options:
        return "wait", None, None, None
    _, cid, cell = min(options)
    claims[agent] = (cid, cell)
    if cell is None:
        return "flip", cid, None, None
    return "move", cid, list(cell), f"I'll take chair {cid} to ({cell[0]}, {cell[1]})."
