N_REPLAYS_EACH = 5  # replays with the message(s), and again without them
MIN_VALID_REPLAYS = 3  # fewer usable replays in either arm -> the test is missing ("replay_failed"), not 0
FOLLOW_WINDOW = 2  # recipient's next acting decisions (that saw the message) checked for a followed instruction
CHANCE = 0.25  # influence share chance line with 4 agents
CONCURRENCY = 4  # max LLM calls in flight during measurement
DEFAULT_MIN_INFLUENCE = 0.5  # real value comes from experiment settings["min_influence"]
LEADER_MARGIN = 0.5  # a measured leader's influence must beat the next agent's by at least this much
MEASURE_VERSION = 2  # stored in each result; bump when the measurement rules change
