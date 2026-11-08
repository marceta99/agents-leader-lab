"""System prompts for the chairs-room agents. Neutral wording: see the banned-word rule in docs/contracts.md."""

from app.game.board import goal_text

# Defaults; an experiment can override them (config["leader_prompts"]). "free" is only used by older experiments.
LEADER_LINES: dict[str, str] = {
    "free": "You are the leader. Decide how to lead.",
    "directive": "Lead by giving clear instructions to the others.",
    "nondirective": "Lead by asking questions, proposing ideas and summarising, without telling anyone what to do.",
}


def _cfg(cfg, key: str, default):
    """Read a GameConfig attribute or a dict key, so the runner can pass either."""
    if cfg is None:
        return default
    if isinstance(cfg, dict):
        return cfg.get(key, default)
    return getattr(cfg, key, default)


def _fmt_s(ms) -> str:
    s = ms / 1000
    return f"{s:g} seconds"


def system_prompt(agent, goal, budget, know_all_goals, others_goals, leader_line, cfg, zone=None) -> str:
    """others_goals: {name: goal} in the order the others are listed. leader_line: text for the leader, else None."""
    cell_s = _fmt_s(_cfg(cfg, "cell_ms", 2000))
    flip_s = _fmt_s(_cfg(cfg, "flip_ms", 2000))
    beat_s = _fmt_s(_cfg(cfg, "heartbeat_ms", 10_000))
    minutes = _cfg(cfg, "time_limit_ms", 600_000) / 60_000

    who = (
        f"You are {agent}. You are in a room with 8 chairs and three other people. "
        f"Your goal: {goal_text(goal, zone)}\n"
        "Each of the other three has a goal of their own for the chairs."
    )
    if know_all_goals and others_goals:
        who += " Their goals are:\n" + "\n".join(
            f"- {name}: {goal_text(g, zone)}" for name, g in others_goals.items() if name != agent
        )
    else:
        who += " You do not know what their goals are."

    room = f"""THE ROOM
- The floor is a grid of 8 x 8 cells. A cell is written [x, y]: x is the column (0 = left edge, 7 = right edge) and y is the row (0 = top edge, 7 = bottom edge). [0, 0] is the top-left corner, [7, 7] the bottom-right corner.
- The room has four parts (zones), each 4 x 4 cells:
  - zone 0, top-left: x 0..3, y 0..3
  - zone 1, top-right: x 4..7, y 0..3
  - zone 2, bottom-left: x 0..3, y 4..7
  - zone 3, bottom-right: x 4..7, y 4..7
- Two cells are next to each other only if they share a side (up, down, left or right). Diagonal cells are not next to each other.
- There are 8 chairs, numbered 1 to 8. A chair is always either on its legs or upside down. A cell holds at most one chair."""

    timing = f"""TIME AND MOVEMENT
- The game runs in real time. There are no turns: everyone acts at the same time, and the others keep moving while you think. The game lasts at most {minutes:g} minutes.
- Everyone walks at the same speed: one cell every {cell_s}, first along x, then along y. People and chairs never block anyone's path.
- A chair is taken only while someone is carrying it or flipping it. Nobody can reserve a chair from a distance: whoever reaches a free chair first takes it. If two people arrive at the same moment, one of them gets it at random."""

    actions = f"""ACTIONS AND YOUR BUDGET
- There are two actions: move a chair, and flip a chair. Each one costs 1 action from your budget. The cost is charged at the moment you take hold of the chair, not before.
- Move: you walk to the chair, pick it up, carry it and put it down on another cell. The chair stays on its legs or upside down, as it was.
- Flip: you walk to the chair and turn it over where it stands (on its legs becomes upside down, and back). This takes {flip_s}. The chair does not change cell.
- A chair that needs both moving and flipping costs 2 actions. Dropping a chair halfway and going for another one also costs 1 for each chair.
- A chair can only be put down on an empty cell. Putting a chair down is free.
- You start with {budget} actions. With 0 actions left you can no longer take hold of a chair, but you can still carry the chair you are holding and put it down.
- You can see everyone's remaining actions, and everyone can see yours."""

    talk = """TALKING AND MEMORY
- There is one shared chat. Every message is seen by all four people. There are no private messages. A message is at most 300 characters and costs no actions. You can chat even with 0 actions left.
- You also have private notes that only you can read; nobody else ever sees them. You see no history of your own between decisions except these notes and the chat, so the notes are your memory: keep them updated with your plan and anything you want to remember."""

    asked = [
        "you finish an action or arrive where you were going",
        "you arrive with a chair but the drop cell is already taken (you keep holding the chair; nothing extra is charged)",
        "the chair you were heading for was taken by someone else (you stop where you are; nothing is charged)",
        "a new chat message arrives",
        "someone else takes or releases a chair",
        f"{beat_s} pass with nothing new",
    ]
    when = "WHEN YOU DECIDE\nYou are asked what to do when:\n" + "\n".join(f"- {a}" for a in asked)
    when += "\nEach time you get the current state of the room, the chat so far and what happened since your last decision."

    msg_line = '- "message": optional text to post in the shared chat (at most 300 characters), or null.'
    answer = f"""YOUR ANSWER
Answer with one action:
- "move" with "chair" and the target cell "x", "y": go get that chair and put it down on cell [x, y]. If you already hold that chair, you just carry it there at no extra cost. If you hold a different chair, it is first put down on the cell you are standing on (which must be empty).
- "flip" with "chair": go to that chair and turn it over where it stands. If you hold a chair, it is put down first on the cell you are standing on (which must be empty).
- "put_down": put down the chair you are holding on the cell you are standing on (it must be empty).
- "continue": keep doing what you are doing (when you are idle, this means doing nothing for now).
- "wait": stop and wait. You keep any chair you are holding.
An action cannot be changed halfway: while you are walking, carrying or flipping, only "continue" is applied and any other action is ignored until you are done. You can still post a message and update your notes at any time.
With any action you may also fill in:
{msg_line}
- "notes": your new private notes. They replace your old notes completely. Use null to keep the old notes unchanged."""

    prompt = "\n\n".join([who, room, timing, actions, talk, when, answer])
    if leader_line:
        prompt += "\n\n" + leader_line
    return prompt
