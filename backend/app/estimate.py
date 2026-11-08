"""Pre-launch cost estimate. All guesses live here; retune them after real runs (plan, milestone 10 metric)."""

from app.pricing import cost_usd

CALLS_PER_AGENT = 35  # decision calls per agent per run (triggers + heartbeats; the hard limit is call_limit)
INPUT_TOKENS_PER_CALL = 3500  # system prompt + state block + chat
OUTPUT_TOKENS_PER_CALL = 700  # at effort "low", thinking included
EFFORT_OUTPUT_FACTOR = {"low": 1.0, "medium": 2.0, "high": 4.0}
MEASURE_FACTOR = 0.4  # measurement (labels + replays) adds about 40% on top of the game


def estimate(config: dict, settings: dict) -> dict:
    groups = 4 if config.get("add_leader") else 1
    team_runs = config["runs"] * groups
    solo_runs = config["runs"] if config.get("solo_baseline") else 0
    calls = (team_runs * 4 + solo_runs) * CALLS_PER_AGENT
    out_tokens = calls * OUTPUT_TOKENS_PER_CALL * EFFORT_OUTPUT_FACTOR.get(settings.get("effort", "low"), 1.0)
    usd = cost_usd(config["model"], calls * INPUT_TOKENS_PER_CALL, int(out_tokens)) * (1 + MEASURE_FACTOR)
    return {"runs_total": team_runs + solo_runs, "calls_estimate": calls, "usd_estimate": round(usd, 2)}
