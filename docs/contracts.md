# Shared contracts

Every part of the system is built against this file. Read it fully before you write code. If you need something this file does not define, add the smallest thing that fits and say so in your report. Never silently change an existing contract.

The product rules are in `product-overview.md` and the build plan is in `plan-agents-leader-lab.md`, both in the repo root. Where this file is more specific, this file wins.

## Coordinates, names, ids

- **Grid:** 8x8. A cell is `[x, y]` with `x` (column) and `y` (row) both in `0..7`. `[0, 0]` is the top-left corner.
- **Zones:** `zone = (y // 4) * 2 + (x // 4)`.

  | Zone | Area | x | y |
  |---|---|---|---|
  | 0 | top-left | 0..3 | 0..3 |
  | 1 | top-right | 4..7 | 0..3 |
  | 2 | bottom-left | 0..3 | 4..7 |
  | 3 | bottom-right | 4..7 | 4..7 |

  The frontend colours zones 0..3 with CSS vars `--z1..--z4`.
- **Chairs:** ids `1..8`. Each chair has `upside_down: bool` and starts as `false`.
- **Agents:** names `"Sam"`, `"Sky"`, `"Sol"`, `"Sage"` (short, gender-neutral). Each run's seed decides which name plays which goal and the order agents are listed in (prompts, observation, events). Older runs used `"Ada"`, `"Bo"`, `"Cy"`, `"Dee"`.
- **Goals:** ids and the English text agents see.

  | Goal id | Text shown to agents |
  |---|---|
  | `circle` | "Arrange the chairs in a circle." |
  | `upside_down` | "Turn all the chairs upside down." |
  | `one_zone` | "Move all the chairs to zone {z} (the {top-left\|top-right\|bottom-left\|bottom-right} part of the room)." The target zone `z` is fixed per layout. |
  | `touching` | "Make all the chairs touch each other." |

- **Groups:** `none | free | directive | nondirective` (older data may hold `solo`, which is no longer created).
- **Adjacency:** distance and adjacency are always orthogonal (up, down, left, right). Diagonals never count.

## Game engine API (`backend/app/game/`, pure Python, no I/O)

```python
from app.game.layouts import Layout, make_layout          # make_layout(n: int, budgets: list[int], seed: int = 0) -> Layout
from app.game.engine import Game, GameConfig

cfg = GameConfig(cell_ms=2000, flip_ms=2000, time_limit_ms=600_000, heartbeat_ms=10_000,
                 know_all_goals=False, leader=None | "Sky", leader_style=None | "free" | "directive" | "nondirective")
game = Game(layout, cfg, group="none", seed=run_seed)   # game time starts at 0 ms
game.start()                 # emits run_started
game.tick(now_ms)            # advance the simulation to now_ms (monotonic, called ~every 100 ms by the runner)
game.decide(agent, kind, chair=None, cell=None) -> tuple[str, str | None]   # (outcome, reason)
                             # outcome: "ok" | "invalid" | "ignored_busy"; kind: move|flip|put_down|continue|wait
game.say(agent, text) -> int # appends a chat message (≤300 chars, newlines -> spaces), emits `message`, returns message id
game.set_notes(agent, text)  # emits `notes` (viewer-only)
game.observation(agent) -> dict      # what this agent may see, see below
game.take_triggers(agent) -> list[str]  # English sentences of what happened for this agent since last call; clears them
game.wants_call(agent, now_ms) -> bool  # True if agent has new triggers, or is idle and heartbeat_ms passed since its last decision
game.is_busy(agent) -> bool  # walking / carrying to a destination / flipping
game.record_decision(agent, kind, now_ms)  # runner calls after each decision (any outcome); used for all_waiting + heartbeat
game.end(reason)             # force end (e.g. "call_limit", "stopped")
game.ended -> str | None     # end reason once ended
game.events -> list[dict]    # all events so far; game.drain_events() -> list[dict] returns new ones since last drain
game.chat -> list[dict]      # [{"id": 1, "agent": "Sam", "text": "...", "t": 1234}]
```

`Layout` fields:

- `n`
- `chairs: list[(id, (x, y))]`
- `agents: list[(name, (x, y))]`, in the run's shuffled listing order
- `goals: dict[name, goal_id]`
- `budgets: dict[name, int]`
- `leader: name`, the agent with the layout's leader goal (used only by leader groups)
- `min_actions: int`, in 14..16, counted for a ring inside the target zone
- `zone: int`, the zone the `one_zone` goal names

What is fixed by `n` (`LAYOUT_VERSION = 2`): chair cells, one start cell per goal, the target zone, and the roles. `roles(n)` gives `(leader goal, rich goal)`: the leader goal cycles `circle, upside_down, one_zone, touching` every layout, and the rich goal is offset by 1, 2, 3, 0 in blocks of 4 layouts, so layouts 1..16 hold every pair once. The largest budget goes to the rich goal and the rest follow in goal order. What the run seed changes: which name plays which goal, and the listing order. So a goal keeps its start cell, budget and leader role whatever name plays it.

### Decision semantics (engine)

- **`move(chair, cell)`.** The agent walks to the chair. On arrival:
  - If the chair is free, the agent takes it and 1 is charged. It then walks to `cell` and drops the chair if the cell is empty.
  - If the drop cell is occupied, the agent keeps holding the chair, stops, and gets a trigger.
  - If the chair is held or being flipped by another agent on arrival, the agent stops and gets a trigger naming who has it. Nothing is charged.

  Exceptions:

  - If the agent already holds `chair`, it simply walks to `cell`, with no new charge.
  - If it holds a different chair, it first drops the held one on its current cell. If its current cell is occupied by another chair, the decision is `invalid` with a reason.
- **`flip(chair)`.** The agent walks to the chair. On arrival, if the chair is free, the agent takes it (1 charged) and flips it on the spot for `flip_ms`, during which the chair is locked. Then the chair's `upside_down` toggles and the chair is free again. If the agent holds a chair, it is dropped first under the same rule as `move`.
- **`put_down`.** Drop the held chair on the current cell. Invalid if the agent holds nothing, or if the cell already has a chair.
- **`continue`.** No change.
- **`wait`.** Stop. Only valid when not busy; while busy it is `ignored_busy`. The agent keeps a held chair.
- **Invalid decisions.** These are invalid: a chair id that doesn't exist, a cell out of the grid, `budget_left == 0` for a move/flip of a chair the agent does not already hold, or a target cell that holds a chair which isn't the moved chair. An invalid decision returns `("invalid", reason)` and changes nothing.
- **While busy.** While busy, any kind other than `continue` returns `ignored_busy` and changes nothing. The product rule is that an action cannot be changed halfway through.
  - **Exception:** if the chair the agent is walking towards gets taken by someone else, the engine stops the agent at its current cell, so it is idle again. It emits `agent_stopped` and a trigger like `"Bo took chair 5, which you were heading for."`
- **Arrival ties.** If two agents arrive at the same chair on the same tick, one is picked at random using the game's seeded RNG.
- **Movement.** One cell per `cell_ms`: first along x, then along y. Agents and chairs never block movement. A carried chair moves with its agent.
- **End reasons:**
  - `solved`: all 4 goals are met and no chair is held.
  - `budget_exhausted`: every budget is 0 and no chair is held.
  - `all_waiting`: every agent is idle, each agent's last recorded decision came after the last state change (any event other than `decision` and `notes`) and was `wait`/`continue`, and at least `heartbeat_ms` have passed since the last state change.
  - `time_limit`.
  - `call_limit`: set by the runner.
  - `stopped`: set by the runner.

### Observation (engine → LLM agent)

```json
{
  "t_ms": 41200,
  "time_left_s": 559,
  "target_zone": 2,
  "you": {
    "name": "Sky", "cell": [3, 4], "state": "idle|walking|carrying|flipping",
    "holding": 5,                      // chair id or null
    "heading": {"kind": "move", "chair": 5, "cell": [1, 1]},   // or null
    "budget_left": 4,
    "goal": "circle",
    "goal_met": false
  },
  "others": [{"name": "Sam", "cell": [0, 0], "holding": null, "budget_left": 6, "goal": null}],   // goal only when know_all_goals
  "chairs": [{"id": 1, "cell": [2, 2], "upside_down": false, "held_by": null}]
}
```

Every agent sees everyone's remaining actions. Agents never see other agents' notes, destinations or leader status. Unit tests must guard this.

## Events (engine → DB `run_events` → WebSocket → frontend reducer)

Wire shape: `{"seq": 17, "t": 41200, "type": "chair_taken", "data": {...}}`.

- `seq` starts at 1 and has no gaps.
- `t` is ms of game time since the run started.
- DB columns: `seq`, `t_ms`, `type`, `data`.

| type | data | notes |
|---|---|---|
| `run_started` | `{"layout_no", "group", "grid": 8, "cell_ms", "flip_ms", "time_limit_ms", "know_all_goals", "target_zone", "seed", "min_actions", "agents": [{"name","cell","goal","budget","is_leader","leader_style"}], "chairs": [{"id","cell","upside_down"}]}` | Viewer-only fields included (goals, budgets, leader). |
| `agent_step` | `{"agent", "from": [x,y], "to": [x,y], "dur_ms"}` | One per cell. The event's `t` is the start of the step. If the agent is carrying, the chair moves with it. |
| `agent_stopped` | `{"agent", "cell", "reason"}` | Walk interrupted (`chair_taken`, `cell_occupied`). |
| `chair_taken` | `{"agent", "chair", "for": "move"\|"flip", "budget_left"}` | The agent now holds or locks the chair. |
| `chair_dropped` | `{"agent", "chair", "cell"}` | |
| `flip_started` | `{"agent", "chair", "dur_ms"}` | |
| `flip_done` | `{"agent", "chair", "upside_down"}` | The chair is free again. |
| `message` | `{"agent", "id", "text"}` | Chat, visible to all agents. |
| `notes` | `{"agent", "text"}` | Viewer-only. |
| `decision` | `{"agent", "n", "kind", "chair", "cell", "outcome", "reason"}` | Emitted by the runner after each LLM decision. `outcome`: `ok`, `invalid`, `skipped_invalid`, `skipped_chose` (for `wait`/`continue` when idle), `ignored_busy`. |
| `goals` | `{"met": {"circle": bool, "upside_down": bool, "one_zone": bool, "touching": bool}}` | Emitted at start and whenever any value changes. |
| `cost` | `{"usd"}` | Cumulative run cost, emitted by the runner after LLM calls. Optional for the viewer. |
| `run_ended` | `{"reason", "solved", "met": {...}, "duration_ms", "completion"}` | Always the last event. `completion` (0..1) = `1 - actions_left / min_actions`, clamped; `actions_left` = chairs not yet upside down + chairs not on the best ring in the target zone. 1.0 when solved. |

The frontend rebuilds the full board at any time `t` from the events with `t <= t` (`frontend/src/run/reducer.ts`). There is no other source of truth.

## LLM decision call (`backend/app/agents/`)

- **Statelessness.** Each call is one stateless request: a system prompt and one user message. Memory between calls lives only in the agent's notes, which are included in the request.
- **Request shape.** The exact request is stored in `decisions.request`:

  ```json
  {
    "model": "claude-haiku-5-5",
    "system": "<system prompt>",
    "messages": [{"role": "user", "content": [
      {"type": "text", "text": "<state block: time, you, others, chairs grid + list, notes, what happened>"},
      {"type": "text", "text": "Chat so far:\n[m1] Sam: hello\n[m2] Sky: I will flip chair 3"}
    ]}]
  }
  ```

  The chat is **always the second text block**, one line per message in the form `[m{id}] {agent}: {text}`. If there is no chat yet, the block is `"Chat so far:\n(none)"`. Measurement removes exactly one message by deleting the line that starts with `[m{id}] `. After removal, a block with no lines left becomes `(none)`.
- **Output schema.** Structured output (Pydantic) validates the response:

  ```python
  class Decision(BaseModel):
      action: Literal["move", "flip", "put_down", "continue", "wait"]
      chair: int | None = None
      x: int | None = None
      y: int | None = None
      message: str | None = None   # optional chat message, cut to 300 chars
      notes: str | None = None     # replaces the agent's private notes when not null
  ```

- **Functions** in `app/agents/llm.py`:
  - `async def call_decision(client, request: dict, effort: str) -> CallResult`, where `CallResult` has `decision: Decision | None`, `raw: dict`, `input_tokens: int`, `output_tokens: int`, `cost_usd: float` and `error: str | None`. It runs one call, with no retry of invalid output; retrying is the runner's job.
  - `def build_request(model, system, observation, triggers, chat, notes) -> dict`.
  - `def system_prompt(agent, goal, budget, know_all_goals, others_goals, leader_line, cfg, zone=None) -> str`. `others_goals` is in listing order; `leader_line` is the leader's extra line or `None`.
- **Prompt wording.** The system prompt never contains "leader", "lead", "team", "coordinate", "manager" or "boss", except for the leader agent's one extra line. These are the defaults; an experiment may replace them (`config["leader_prompts"]`, set on the New experiment form):

  | Leader style | Extra line |
  |---|---|
  | free | "You are the leader. Decide how to lead." |
  | directive | "Lead by giving clear instructions to the others." |
  | nondirective | "Lead by asking questions, proposing ideas and summarising, without telling anyone what to do." |

- **Model settings.** No `temperature` is sent (current models reject it). `output_config.effort` comes from settings (default `"low"`). Thinking is left at the model default.

## Run result (`runs.result`, written by measurement, read by the results UI)

```json
{
  "solved": true, "completion": 1.0, "seed": 1288342217, "duration_ms": 312000, "end_reason": "solved",
  "goals_met": {"circle": true, "upside_down": true, "one_zone": true, "touching": true},
  "leader_agent": "Sky",           // agent told to lead; null in the none group
  "richest_agent": "Sam",          // unique max budget; null on a tie (e.g. 6/6/6/6)
  "leader_is_richest": false,      // null if either is null
  "measured_leader": "Sky",        // null = no leader
  "influence": {"Sam": 0.0, "Sky": 1.67, "Sol": 0.0, "Sage": 0.33},          // given
  "influence_received": {"Sam": 1.0, "Sky": 0.0, "Sol": 0.67, "Sage": 0.33},
  "influence_share": {"Sam": 0.0, "Sky": 0.83, "Sol": 0.0, "Sage": 0.17},    // all 0 if total is 0
  "instructions": [{"message_id": 3, "from": "Sky", "to": "Sol", "action": {"kind": "flip", "chair": 2, "cell": null},
                    "followed": true, "p_with": 1.0, "p_without": 0.33, "score": 0.67}],
  "styles": {"3": "directive", "4": "non_directive"},     // message id (string) -> directive | non_directive | other
  "style_mix": {"Sky": {"directive": 2, "non_directive": 1, "other": 0}},
  "invalid_share": 0.02,           // share of decisions that ended skipped_invalid
  "partial": false,                // true if measurement was cut short (cap reached)
  "measure_cost_usd": 0.04
}
```

## Global settings (`app/settings_store.py`)

`DEFAULTS` lives in that file. An experiment snapshots it at creation as `config["settings"]`, and the run uses the snapshot, never live settings.

## Experiment config (`experiments.config`)

```json
{"name": "Goals hidden · Equal budget 6 · No leader", "know_all_goals": false, "budget": [6, 6, 6, 6],
 "add_leader": false, "runs": 10, "model": "claude-haiku-5-5", "cap_usd": 5.0,
 "leader_prompts": null,          // with a leader: {"free": "...", "directive": "...", "nondirective": "..."}
 "settings": {...global snapshot...}, "layout_version": 2}
```

- **Name:** generated from the config (goals known/hidden, budget, leader groups); there is no name field.
- **Leader prompts:** only with a leader. Missing or blank groups get the default; each at most 1000 characters.
- **Validation:** budget has 4 ints in `0..budget_max_per_agent` with sum `>= budget_min_total`; runs in `1..max_runs`; model in `settings.models`; cap > 0.
- **Rows:** all `runs` rows are created at launch. For each layout `i` in `1..runs`:
  - one run per group (`none` only, or `none, free, directive, nondirective` with a leader);
  - each run gets a random `seed` (`runs.seed`), also written to `run_started` and `runs.result`.

## REST + WebSocket API

All paths are same-origin. Auth is an httpOnly cookie `session` (a JWT). Errors are `{"detail": "..."}`.

**Auth & key**

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/auth/signup` | `{email, password}` | `{id, email, is_admin}`, sets the cookie. 409 if the email exists, 422 if invalid. Password ≥ 8 chars. |
| `POST /api/auth/login` | `{email, password}` | `{id, email, is_admin}`. 401 `"Wrong email or password"`. |
| `POST /api/auth/logout` | | 204 |
| `GET /api/me` | | `{id, email, is_admin, has_key, key_last4}`, or 401. |
| `PUT /api/key` | `{key}` | `{last4}`, or 400 `"Invalid key"`. Checked with a 1-token test call. |
| `GET /api/key` | | `{last4}`, or 404. |
| `DELETE /api/key` | | 204. Also stops the user's running experiments, which the scheduler checks before each call. |

**Experiments** (owner only)

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/experiments/estimate` | config fields without `leader_prompts` | `{runs_total, calls_estimate, usd_estimate}` |
| `POST /api/experiments` | `{know_all_goals, budget, add_leader, runs, model, cap_usd, leader_prompts?}` | `ExperimentDetail`. 400 if there is no key. |
| `GET /api/experiments` | | `[ExperimentSummary]`, newest first |
| `GET /api/experiments/{id}` | | `ExperimentDetail` |
| `POST /api/experiments/{id}/stop` | | 204 |
| `DELETE /api/experiments/{id}` | | 204 (stops first if running) |
| `GET /api/experiments/{id}/results?richest=any\|leader_is_richest\|leader_not_richest` | | `ExperimentResults` |
| `GET /api/experiments/{id}/export.json` | | Full JSON (config, runs with result, events, decisions without any key) |
| `GET /api/experiments/{id}/export.zip` | | `runs.csv` + `messages.csv` |

Response shapes:

- `ExperimentSummary`: `{id, name, status, created_at, runs_done, runs_total, spent_usd, cap_usd, model, add_leader, is_demo}`.
- `ExperimentDetail`: `ExperimentSummary` + `{config, stop_reason, runs: [RunSummary]}`.
- `RunSummary`: `{id, group, layout_no, status, end_reason, solved, completion, seed, measured_leader, leader_agent, cost_usd}`.
- `ExperimentResults`:

  ```json
  {"groups": {"none": GroupStats, "free": ..., ...},
   "overall": GroupStats,
   "excluded": n}
  ```

  `GroupStats` is `{runs, solved_rate, completion_avg, leader_rate, avg_duration_s, richest_leader_rate, leader_became_measured_rate, leader_share_avg, style_mix: {directive, non_directive, other}}`. A rate is `null` when its denominator is 0. `excluded` counts stopped, failed and partial runs.

**Runs**

| Endpoint | Response | Access |
|---|---|---|
| `GET /api/runs/{id}` | `{id, experiment_id, experiment_name, group, layout_no, status, end_reason, cost_usd, result, share_token, is_owner}` | owner, or a run of a demo experiment |
| `GET /api/runs/{id}/events` | `[event]` | same as above |
| `POST /api/runs/{id}/share` | `{token}` | owner |
| `DELETE /api/runs/{id}/share` | 204 | owner |
| `WS /ws/runs/{id}?after=<seq>` | | owner, or a demo run |
| `WS /ws/public/{token}?after=<seq>` | | anyone with the token |

The WebSocket sends every stored event with `seq > after`, then live events as they happen. When it sends `run_ended`, the server closes the socket.

**Public** (no auth)

| Endpoint | Response |
|---|---|
| `GET /api/public/runs/{token}` | Same shape as `GET /api/runs/{id}`, with `is_owner: false` and no `share_token`. |
| `GET /api/public/runs/{token}/events` | `[event]` |
| `GET /api/public/demos` | `[{experiment: ExperimentSummary (no user info), runs: [RunSummary]}]` |

**Admin** (`is_admin`; 403 otherwise)

| Endpoint | Request | Response |
|---|---|---|
| `GET /api/admin/settings` | | settings dict |
| `PUT /api/admin/settings` | settings dict | merged settings dict |
| `POST /api/admin/experiments/{id}/demo` | `{is_demo}` | 204. Only the admin's own experiments. |

**Dev** (only when `ENV=dev`)

| Endpoint | Response |
|---|---|
| `POST /api/dev/scripted-run` | `{run_id}`. Starts a run with no experiment, played by scripted bots, so no API key is needed. |

## Frontend file ownership

- `src/api.ts`: fetch wrapper (`api()`, `wsUrl()`).
- `src/App.tsx`: routes. Do not restructure it; add routes only if needed.
- `src/index.css`: shared tokens and base classes. Add component CSS in your own files.
- `src/run/*`: the run viewer (3D room, chat, agent panel, timeline, reducer).
- `src/pages/*`: one file per route.
