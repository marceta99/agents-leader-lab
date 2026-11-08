"""Pure scoring helpers: no I/O, no LLM."""

from app.measure.config import FOLLOW_WINDOW

ACTING = ("move", "flip", "put_down")
STYLES = ("directive", "non_directive", "other")


def _get(ins, key):
    return ins[key] if isinstance(ins, dict) else getattr(ins, key)


def matches(instruction, action: dict | None) -> bool:
    """Action {"kind","chair","cell"} does what the instruction asked (cell only checked when named)."""
    if not action or action.get("kind") != _get(instruction, "kind") or action.get("chair") != _get(instruction, "chair"):
        return False
    x, y = _get(instruction, "x"), _get(instruction, "y")
    if x is None or y is None:
        return True
    return list(action.get("cell") or []) == [x, y]


def followed(instruction, message_t: int, recipient_decisions: list[dict]) -> tuple[bool, dict | None]:
    """Did the recipient's next FOLLOW_WINDOW acting (ok move/flip/put_down) decisions after the message match it?"""
    acting = [
        d for d in sorted(recipient_decisions, key=lambda d: (d["t_ms"], d["seq"]))
        if d["t_ms"] > message_t and d.get("outcome") == "ok" and (d.get("action") or {}).get("kind") in ACTING
    ]
    for d in acting[:FOLLOW_WINDOW]:
        if matches(instruction, d["action"]):
            return True, d
    return False, None


def instruction_score(p_with: float, p_without: float) -> float:
    return max(0.0, p_with - p_without)


def measured_leader(influence_by_agent: dict[str, float], followers_by_agent: dict[str, set], min_influence: float) -> str | None:
    if not influence_by_agent:
        return None
    top = max(influence_by_agent, key=influence_by_agent.get)
    best = influence_by_agent[top]
    if best < min_influence or len(followers_by_agent.get(top, ())) < 2:
        return None
    if any(v == best for a, v in influence_by_agent.items() if a != top):
        return None
    return top


def shares(influence_by_agent: dict[str, float]) -> dict[str, float]:
    total = sum(influence_by_agent.values())
    return {a: (v / total if total else 0.0) for a, v in influence_by_agent.items()}


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
