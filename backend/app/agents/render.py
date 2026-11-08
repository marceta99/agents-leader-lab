"""Render an engine observation (docs/contracts.md "Observation") into the text an agent reads."""

from app.game.board import goal_text

GRID = 8


def zone(cell) -> int:
    x, y = cell
    return (y // 4) * 2 + (x // 4)


def _cell(cell) -> str:
    return f"[{cell[0]}, {cell[1]}] (zone {zone(cell)})"


def _holding(chair_id) -> str:
    return f"chair {chair_id}" if chair_id is not None else "nothing"


def _heading(h) -> str:
    if not h:
        return "none"
    if h.get("kind") == "flip":
        return f"going to flip chair {h['chair']}"
    if h.get("kind") == "move":
        return f"moving chair {h['chair']} to [{h['cell'][0]}, {h['cell'][1]}]"
    return str(h)


def _map(chairs) -> list[str]:
    grid = [["." for _ in range(GRID)] for _ in range(GRID)]
    for c in chairs:
        x, y = c["cell"]
        grid[y][x] = f"{c['id']}{'*' if c['upside_down'] else ''}"
    header = "     " + "".join(f"{x:<3}" for x in range(4)) + "| " + "".join(f"{x:<3}" for x in range(4, 8))
    lines = ["Room map (columns are x, rows are y; a digit is a chair id on its legs, a digit with * is that chair upside down, . is an empty cell; | and --- are the zone borders):", header.rstrip()]
    for y in range(GRID):
        row = grid[y]
        lines.append((f"y={y}  " + "".join(f"{v:<3}" for v in row[:4]) + "| " + "".join(f"{v:<3}" for v in row[4:])).rstrip())
        if y == 3:
            lines.append("     " + "-" * 12 + "+" + "-" * 13)
    return lines


def render_state(observation: dict, triggers: list[str], notes: str | None) -> str:
    you = observation["you"]
    others = observation.get("others", [])
    chairs = sorted(observation["chairs"], key=lambda c: c["id"])
    name = you["name"]
    zone_no = observation.get("target_zone")

    lines = [f"Time left: {observation['time_left_s']} s", "", "Your status:"]
    lines.append(f"- You are {name}, standing on cell {_cell(you['cell'])}.")
    lines.append(f"- State: {you['state']}. Holding: {_holding(you.get('holding'))}.")
    lines.append(f"- Current action: {_heading(you.get('heading'))}.")
    lines.append(f"- Actions left: {you['budget_left']}.")
    lines.append(f"- Your goal: {goal_text(you['goal'], zone_no)} Currently met: {'yes' if you.get('goal_met') else 'no'}.")
    lines.append("")
    lines += _map(chairs)
    lines.append("")
    lines.append("Chairs:")
    for c in chairs:
        holder = c.get("held_by")
        held = "free" if holder is None else ("held by you" if holder == name else f"held by {holder}")
        state = "upside down" if c["upside_down"] else "on its legs"
        lines.append(f"- Chair {c['id']}: cell {_cell(c['cell'])}, {state}, {held}.")
    if others:
        lines.append("")
        lines.append("Other people:")
        for o in others:
            line = f"- {o['name']}: cell {_cell(o['cell'])}, holding {_holding(o.get('holding'))}"
            if o.get("budget_left") is not None:
                line += f", actions left: {o['budget_left']}"
            line += "."
            if o.get("goal"):
                line += f" Goal: {goal_text(o['goal'], zone_no)}"
            lines.append(line)
    lines.append("")
    lines.append("Your notes:")
    lines.append(notes if notes else "(empty)")
    lines.append("")
    lines.append("What happened since your last decision:")
    lines += [f"- {t}" for t in triggers] if triggers else ["(nothing new)"]
    return "\n".join(lines)


def render_chat(chat: list[dict]) -> str:
    """Contract: 'Chat so far:' then one '[m{id}] {agent}: {text}' line per message, or '(none)'."""
    if not chat:
        return "Chat so far:\n(none)"
    return "Chat so far:\n" + "\n".join(
        f"[m{m['id']}] {m['agent']}: {m['text'].replace(chr(10), ' ').replace(chr(13), ' ')}" for m in chat
    )
