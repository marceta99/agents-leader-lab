import json
import re
from types import SimpleNamespace

import anthropic
import httpx2
import pydantic
import pytest

from app.agents.llm import Decision, build_request, call_decision, remove_message
from app.agents.prompts import GOAL_TEXT, LEADER_LINES, system_prompt
from app.agents.render import render_chat
from app.pricing import cost_usd

BANNED = re.compile(r"\b(lead\w*|team\w*|coordinat\w*|manag\w*|boss\w*)", re.I)
CFG = {"cell_ms": 2000, "flip_ms": 2000, "time_limit_ms": 600_000, "heartbeat_ms": 10_000}
GOALS = {"Ada": "circle", "Bo": "upside_down", "Cy": "one_zone", "Dee": "touching"}


def prompt(**kw):
    args = dict(agent="Bo", goal="upside_down", budget=5, know_all_goals=False, others_goals=None,
                leader_style=None, solo=False, cfg=CFG)
    return system_prompt(**{**args, **kw})


def obs():
    return {
        "t_ms": 41200, "time_left_s": 559,
        "you": {"name": "Bo", "cell": [3, 4], "state": "idle", "holding": None, "heading": None,
                "budget_left": 4, "goal": "circle", "goal_met": False},
        "others": [{"name": n, "cell": [0, i], "holding": None, "goal": None} for i, n in enumerate(["Ada", "Cy", "Dee"])],
        "chairs": [{"id": i, "cell": [i - 1, 7], "upside_down": i == 3, "held_by": "Cy" if i == 2 else None}
                   for i in range(1, 9)],
    }


def chat(n):
    return [{"id": i, "agent": "Ada", "text": f"msg {i}", "t": i} for i in range(1, n + 1)]


def test_prompt_has_no_leadership_words():
    variants = [
        prompt(),
        prompt(know_all_goals=True, others_goals=GOALS),
        prompt(solo=True, agent="Ada", goal=list(GOAL_TEXT), budget=20),
        prompt(solo=True, agent="Ada", goal=list(GOAL_TEXT), budget=20, leader_style="free"),  # solo ignores leader
    ]
    for p in variants:
        assert not BANNED.findall(p), BANNED.findall(p)
    assert GOAL_TEXT["circle"] in variants[1] and GOAL_TEXT["touching"] in variants[1]
    assert GOAL_TEXT["circle"] not in variants[0]
    assert all(GOAL_TEXT[g] in variants[2] for g in GOAL_TEXT)
    assert "shared chat" not in variants[2]


def test_leader_prompt_variants():
    base = prompt()
    for style, line in LEADER_LINES.items():
        p = prompt(leader_style=style)
        assert p == base + "\n\n" + line
        assert not BANNED.findall(p.removesuffix(line))


def test_request_shape_matches_contract():
    r = build_request("claude-haiku-5-5", "SYS", obs(), ["Ada took chair 3."], chat(2), "my plan")
    assert set(r) == {"model", "system", "messages"}
    assert r["model"] == "claude-haiku-5-5" and r["system"] == "SYS"
    assert len(r["messages"]) == 1 and r["messages"][0]["role"] == "user"
    content = r["messages"][0]["content"]
    assert [b["type"] for b in content] == ["text", "text"]
    assert "my plan" in content[0]["text"] and "Ada took chair 3." in content[0]["text"]
    assert content[1]["text"].startswith("Chat so far:\n")
    json.dumps(r)


def test_chat_block_format_and_none():
    assert render_chat([]) == "Chat so far:\n(none)"
    assert render_chat([{"id": 1, "agent": "Ada", "text": "hello"}, {"id": 2, "agent": "Bo", "text": "I will\nflip 3"}]) == \
        "Chat so far:\n[m1] Ada: hello\n[m2] Bo: I will flip 3"


def test_remove_message_exact_line_only():
    r = build_request("claude-haiku-5-5", "S", obs(), [], chat(11), None)
    out = remove_message(r, 1)
    text = out["messages"][0]["content"][1]["text"]
    assert "[m1] " not in text and "[m10] Ada: msg 10" in text and "[m11] Ada: msg 11" in text
    assert text.count("\n") == 10
    assert r["messages"][0]["content"][1]["text"].startswith("Chat so far:\n[m1] ")  # original untouched
    one = build_request("claude-haiku-5-5", "S", obs(), [], chat(1), None)
    assert remove_message(one, 1)["messages"][0]["content"][1]["text"] == "Chat so far:\n(none)"


def test_observation_render_contains_all_chairs_and_no_budgets_of_others():
    text = build_request("claude-haiku-5-5", "S", obs(), [], [], None)["messages"][0]["content"][0]["text"]
    for i in range(1, 9):
        assert f"- Chair {i}: cell [{i - 1}, 7]" in text
    assert "3*" in text and "upside down, free" in text and "held by Cy" in text
    assert "Actions left: 4" in text
    assert text.count("Actions left") == 1 and "budget" not in text.lower()


def fake_client(parse):
    return SimpleNamespace(messages=SimpleNamespace(parse=parse))


def fake_resp(decision, stop_reason="end_turn", tin=1200, tout=300):
    return SimpleNamespace(parsed_output=decision, stop_reason=stop_reason,
                           usage=SimpleNamespace(input_tokens=tin, output_tokens=tout),
                           to_dict=lambda mode="python": {"stop_reason": stop_reason})


REQ = build_request("claude-haiku-5-5", "S", obs(), [], [], None)


async def test_call_decision_ok_cost():
    seen = {}

    async def parse(**kw):
        seen.update(kw)
        return fake_resp(Decision(action="flip", chair=3))

    res = await call_decision(fake_client(parse), REQ, "low")
    assert res.error is None and res.decision.action == "flip" and res.decision.chair == 3
    assert (res.input_tokens, res.output_tokens) == (1200, 300)
    assert res.cost_usd == pytest.approx(cost_usd("claude-haiku-5-5", 1200, 300))
    assert seen["output_format"] is Decision and seen["output_config"] == {"effort": "low"}
    assert "temperature" not in seen and seen["model"] == "claude-haiku-5-5"


async def test_call_decision_invalid_returns_none():
    async def bad_json(**kw):
        Decision.model_validate_json('{"action": "jump"}')

    res = await call_decision(fake_client(bad_json), REQ, "low")
    assert res.decision is None and "invalid" in res.error

    async def refusal(**kw):
        return fake_resp(None, stop_reason="refusal")

    res = await call_decision(fake_client(refusal), REQ, "low")
    assert res.decision is None and res.error == "refusal" and res.cost_usd > 0

    async def overloaded(**kw):
        raise anthropic.OverloadedError("overloaded", response=httpx2.Response(529, request=httpx2.Request("POST", "https://x")), body=None)

    res = await call_decision(fake_client(overloaded), REQ, "low")
    assert res.decision is None and "OverloadedError" in res.error


async def test_auth_error_propagates():
    for cls, code in [(anthropic.AuthenticationError, 401), (anthropic.PermissionDeniedError, 403)]:
        async def parse(**kw):
            raise cls("nope", response=httpx2.Response(code, request=httpx2.Request("POST", "https://x")), body=None)

        with pytest.raises(cls):
            await call_decision(fake_client(parse), REQ, "low")


def test_message_truncated_to_300():
    d = Decision.model_validate_json(json.dumps({"action": "wait", "message": "a" * 500}))
    assert d.message == "a" * 300
    assert Decision(action="wait").message is None
    with pytest.raises(pydantic.ValidationError):
        Decision(action="dance")
