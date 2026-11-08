from typing import Literal

from pydantic import BaseModel, ValidationError

from app.pricing import cost_usd


class Instruction(BaseModel):
    to: str
    kind: Literal["move", "flip"]
    chair: int
    x: int | None = None
    y: int | None = None


class MessageLabel(BaseModel):
    style: Literal["directive", "non_directive", "other"]
    instruction: Instruction | None = None


SYSTEM = """You label chat messages from a cooperative game. Agents move and flip chairs on an 8x8 grid \
(cells [x, y], x = column 0..7, y = row 0..7, [0, 0] is top-left). Chairs have ids 1..8.

1. style: exactly one of
- "directive": explicit instructions or assignments.
- "non_directive": framing the problem, proposing an approach, asking questions, inviting input or summarising.
- "other": everything else.

2. instruction: set it ONLY when the message tells exactly one NAMED other agent (one of the listed agents, \
never the sender) to do ONE concrete action on one specific chair:
- kind "move" (carry the chair to a cell) or "flip" (turn it over), with the chair id;
- x and y only when the message names an exact target cell for a move, otherwise null.
Examples: "Sky, flip chair 2" -> {to: "Sky", kind: "flip", chair: 2}. \
"Cy please move chair 5 to [3,4]" -> {to: "Cy", kind: "move", chair: 5, x: 3, y: 4}.
Set instruction to null when: no agent is named ("someone flip chair 2"); it is a proposal for the group \
("let's flip chair 2"); it is addressed to several agents or to the sender itself; no specific chair is given; \
or it asks for several actions, unless one of them is clearly the instruction to that one agent."""


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
