"""Pre-launch cost estimate. All guesses live here; retune them after real runs (plan, milestone 10 metric)."""

from app.pricing import cost_usd

CALLS_PER_AGENT = 45  # decision calls per agent per run; first real Haiku run: ~52 without the call gap
INPUT_TOKENS_PER_CALL = 8000  # system prompt + state block + growing chat; first real run averaged 8.2K
OUTPUT_TOKENS_PER_CALL = 300  # at effort "low", thinking included; first real run averaged 300
EFFORT_OUTPUT_FACTOR = {"low": 1.0, "medium": 2.0, "high": 4.0}
MEASURE_FACTOR = 0.3  # measurement (labels + replays); first real run: 22% of game cost


def estimate(config: dict, settings: dict) -> dict:
    groups = 4 if config.get("add_leader") else 1
    team_runs = config["runs"] * groups
    solo_runs = config["runs"] if config.get("solo_baseline") else 0
    calls = (team_runs * 4 + solo_runs) * CALLS_PER_AGENT
    out_tokens = calls * OUTPUT_TOKENS_PER_CALL * EFFORT_OUTPUT_FACTOR.get(settings.get("effort", "low"), 1.0)
    usd = cost_usd(config["model"], calls * INPUT_TOKENS_PER_CALL, int(out_tokens)) * (1 + MEASURE_FACTOR)
    return {"runs_total": team_runs + solo_runs, "calls_estimate": calls, "usd_estimate": round(usd, 2)}
