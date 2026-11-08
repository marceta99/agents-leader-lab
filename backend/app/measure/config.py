N_REPLAYS_EACH = 3  # replays with the message, and again without it
FOLLOW_WINDOW = 2  # recipient's next acting decisions checked for a followed instruction
CHANCE = 0.25  # influence share chance line with 4 agents
CONCURRENCY = 4  # max LLM calls in flight during measurement
DEFAULT_MIN_INFLUENCE = 0.5  # real value comes from experiment settings["min_influence"]
