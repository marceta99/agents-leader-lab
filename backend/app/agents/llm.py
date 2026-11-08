"""One stateless Claude call per agent decision (docs/contracts.md "LLM decision call")."""

import copy
from dataclasses import dataclass, field
from typing import Literal

import anthropic
import pydantic
from pydantic import BaseModel, field_validator

from app.agents.render import render_chat, render_state
from app.pricing import cost_usd

MAX_TOKENS = 4000
MESSAGE_MAX = 300


class Decision(BaseModel):
    action: Literal["move", "flip", "put_down", "continue", "wait"]
    chair: int | None = None
    x: int | None = None
    y: int | None = None
    message: str | None = None  # optional chat message, cut to 300 chars
    notes: str | None = None  # replaces the agent's private notes when not null

    @field_validator("message")
    @classmethod
    def _cut(cls, v: str | None) -> str | None:
        return v[:MESSAGE_MAX] if v else v


@dataclass
class CallResult:
    decision: Decision | None
    raw: dict = field(default_factory=dict)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    error: str | None = None


def build_request(model, system, observation, triggers, chat, notes) -> dict:
    return {
        "model": model,
        "system": system,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": render_state(observation, triggers, notes)},
                    {"type": "text", "text": render_chat(chat)},
                ],
            }
        ],
    }


def remove_message(request: dict, message_id: int) -> dict:
    """Deep copy of `request` with exactly the chat line `[m{id}] ` removed (chat is always content[1])."""
    out = copy.deepcopy(request)
    block = out["messages"][0]["content"][1]
    header, *lines = block["text"].split("\n")
    kept = [ln for ln in lines if ln != "(none)" and not ln.startswith(f"[m{message_id}] ")]
    block["text"] = header + "\n" + ("\n".join(kept) if kept else "(none)")
    return out


def make_client(api_key: str) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=api_key, max_retries=5)


async def call_decision(client, request: dict, effort: str) -> CallResult:
    """One call, no retry of invalid output. Auth/permission errors propagate; other API errors -> decision=None."""
    try:
        resp = await client.messages.parse(
            **request,
            max_tokens=MAX_TOKENS,
            output_format=Decision,
            output_config={"effort": effort},
        )
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
        raise
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
        return CallResult(None, error=f"{type(e).__name__}: {e}")
    except pydantic.ValidationError as e:
        # ponytail: the SDK raises before we see usage, so tokens of an unparseable answer are not counted;
        # switch to with_raw_response.parse if invalid answers become frequent enough to matter for the cap.
        return CallResult(None, error=f"invalid output: {e}")

    usage = resp.usage
    tin, tout = usage.input_tokens or 0, usage.output_tokens or 0
    result = CallResult(
        decision=None,
        raw=resp.to_dict(mode="json"),
        input_tokens=tin,
        output_tokens=tout,
        cost_usd=cost_usd(request["model"], tin, tout),
    )
    if resp.stop_reason == "refusal":
        result.error = "refusal"
    elif resp.parsed_output is None:
        result.error = f"no parsed output (stop_reason={resp.stop_reason})"
    else:
        result.decision = resp.parsed_output
    return result
