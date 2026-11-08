from typing import Literal

from pydantic import BaseModel, ValidationError

from app.pricing import cost_usd


class Instruction(BaseModel):
    to: list[str]  # one or more named recipients; all the others when addressed to everyone
    kind: Literal["move", "flip", "avoid"]  # avoid = prohibition: do not move or flip this chair
    chair: int
    x: int | None = None
    y: int | None = None


class Cell(BaseModel):
    x: int
    y: int


class MessageLabel(BaseModel):
    style: Literal["directive", "non_directive", "other"]
    instructions: list[Instruction] = []
    proposed_cells: list[Cell] = []  # target cells the message proposes for a plan or layout


SYSTEM = """You label chat messages from a cooperative game. Agents move and flip chairs on an 8x8 grid \
(cells [x, y], x = column 0..7, y = row 0..7, [0, 0] is top-left). Chairs have ids 1..8.

1. style: exactly one of
- "directive": explicit instructions or assignments.
- "non_directive": framing the problem, proposing an approach, asking questions, inviting input or summarising.
- "other": everything else.

2. instructions: a list, empty when there are none. Add one item for each request the sender makes of other \
agents about ONE specific chair:
- kind "move" (carry the chair; x and y only when an exact target cell is named, otherwise null), "flip" (turn it \
over), or "avoid" (a prohibition: do not move or flip that chair, e.g. "Sky, leave chair 5 alone");
- to: the agents it is addressed to, by name, from the listed agents and never the sender. When it is addressed to \
everyone ("everyone", "all of you", "nobody touch chair 3"), list all the other agents.
- one item per chair: "Sky, flip 3 and 5" gives two items.
Examples: "Sky, flip chair 2" -> [{to: ["Sky"], kind: "flip", chair: 2}]. \
"Sol please move chair 5 to [3,4]" -> [{to: ["Sol"], kind: "move", chair: 5, x: 3, y: 4}]. \
"Sam and Sky, don't move chair 7" -> [{to: ["Sam", "Sky"], kind: "avoid", chair: 7}].
Leave a request out when no agent is named and it is not addressed to everyone ("someone flip chair 2"); it is a \
proposal for the group ("let's flip chair 2"); it is addressed to the sender itself; no specific chair is given; \
or it is unclear which agent should do which chair ("Sam/Sky: 3 and 6").

3. proposed_cells: the target cells the message proposes for chairs as a plan or layout, written as [x, y] in the \
message (e.g. "ring on [3,3],[4,3],[5,3],..."). Leave out cells that only describe where chairs or agents are now. \
Empty list when the message proposes no target cells."""


def _user_text(sender: str, text: str, agents: list[str]) -> str:
    return f"Agents: {', '.join(agents)}\nSender: {sender}\nMessage: {text}"


async def label_message(client, model: str, sender: str, text: str, agents: list[str], effort: str) -> tuple[MessageLabel | None, float]:
    try:
        resp = await client.messages.parse(
            model=model,
            max_tokens=8000,
            system=SYSTEM,
            messages=[{"role": "user", "content": _user_text(sender, text, agents)}],
            output_format=MessageLabel,
            output_config={"effort": effort},
        )
    except ValidationError:
        # ponytail: usage is lost when the SDK fails to validate; such a call is counted as $0.
        return None, 0.0
    cost = cost_usd(model, resp.usage.input_tokens, resp.usage.output_tokens)
    return resp.parsed_output, cost
