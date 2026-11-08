"""Pure scoring helpers: no I/O, no LLM."""

from app.measure.config import FOLLOW_WINDOW, LEADER_MARGIN

ACTING = ("move", "flip", "put_down")
STYLES = ("directive", "non_directive", "other")


def _get(ins, key):
    return ins[key] if isinstance(ins, dict) else getattr(ins, key)


def is_acting(d: dict) -> bool:
    return d.get("outcome") == "ok" and (d.get("action") or {}).get("kind") in ACTING


def matches(instruction, action: dict | None) -> bool:
    """Action {"kind","chair","cell"} does what the instruction asked (cell only checked when named)."""
    if not action or action.get("kind") != _get(instruction, "kind") or action.get("chair") != _get(instruction, "chair"):
        return False
    x, y = _get(instruction, "x"), _get(instruction, "y")
    if x is None or y is None:
        return True
    return list(action.get("cell") or []) == [x, y]


def touches(action: dict | None, chair: int) -> bool:
    """The action moves or flips `chair` (what a prohibition forbids)."""
    return bool(action) and action.get("kind") in ("move", "flip") and action.get("chair") == chair


def moves_to(action: dict | None, cells: set) -> bool:
    """The action carries a chair onto one of `cells` (plan adoption)."""
    return bool(action) and action.get("kind") == "move" and tuple(action.get("cell") or ()) in cells


def followed(instructions, seen_decisions: list[dict]) -> dict | None:
    """The decision that followed: one of the recipient's next FOLLOW_WINDOW acting decisions among `seen_decisions`
    (its decisions whose request already contained the message, in order) that does any of `instructions` (one
    instruction or a list: several requests to one agent in one message count as followed if any one is done)."""
    items = instructions if isinstance(instructions, list) else [instructions]
    acting = [d for d in seen_decisions if is_acting(d)]
    return next((d for d in acting[:FOLLOW_WINDOW] if any(matches(i, d["action"]) for i in items)), None)


def instruction_score(p_with: float, p_without: float) -> float:
    return max(0.0, p_with - p_without)


def measured_leader(influence_by_agent: dict[str, float], followers_by_agent: dict[str, set], min_influence: float,
                    min_followers: int = 1, margin: float = LEADER_MARGIN) -> str | None:
    """Top agent if its influence reaches min_influence, beats the next agent by `margin`, and it has at least
    `min_followers` distinct followers (agents it moved with a positive score)."""
    if not influence_by_agent:
        return None
    top = max(influence_by_agent, key=influence_by_agent.get)
    best = influence_by_agent[top]
    second = max((v for a, v in influence_by_agent.items() if a != top), default=0.0)
    if best < min_influence or best - second < margin - 1e-9 or len(followers_by_agent.get(top, ())) < min_followers:
        return None
    return top


def shares(influence_by_agent: dict[str, float]) -> dict[str, float | None]:
    """Each agent's share of all influence; None for everyone when nobody influenced anyone (share undefined)."""
    total = sum(influence_by_agent.values())
    return {a: (v / total if total else None) for a, v in influence_by_agent.items()}


def richest_agent(budgets: dict[str, int]) -> str | None:
    if not budgets:
        return None
    top = max(budgets.values())
    rich = [a for a, b in budgets.items() if b == top]
    return rich[0] if len(rich) == 1 else None


def style_mix(styles_by_sender: list[tuple[str, str]], agents: list[str]) -> dict[str, dict[str, int]]:
    """styles_by_sender: [(sender, style)] for every labelled message."""
    mix = {a: dict.fromkeys(STYLES, 0) for a in agents}
    for sender, style in styles_by_sender:
        mix.setdefault(sender, dict.fromkeys(STYLES, 0))[style] += 1
    return mix
