# Plan: Agents Leader Lab

## Overview

Build a web platform where users bring their Anthropic API key, configure and launch leader-emergence experiments with 4 LLM agents playing a real-time chairs puzzle, watch them live in a 3D room, and get automatic leadership measurements.
The backend (FastAPI + Postgres) runs the game engine, the LLM agents, the experiment scheduler and the measurement; the frontend (React + Vite + react-three-fiber) shows the 3D room, chat, playback and results.
Everything ships to Railway as 3 services (frontend, backend, Postgres); the product rules live in [product-overview.md](product-overview.md) and this plan never overrides them except where noted in Additional Notes.

## Milestones

| Milestone Name | One-sentence explanation |
|---|---|
| 1. Skeleton & deploy | One repo with FastAPI + Vite apps and Postgres + migrations, auto-deployed to Railway on every push to `main` from day one. |
| 2. Auth & API key | Email/password accounts, admin flag, encrypted Anthropic key with test call, last-4 display and delete. |
| 3. Game engine | Pure-Python real-time chairs game: layouts, walking, move/flip, locking, budgets, goals, end conditions, event log. |
| 4. Live view & 3D room | WebSocket event stream and the 3D room, chat panel, agent panel and playback, driven first by scripted bots. |
| 5. LLM agents | Prompts, board snapshot, structured decisions, event triggers, one call in flight, retries, cost tracking. |
| 6. Experiments & scheduler | Create form, cost estimate, groups (leader / solo), layouts per run, 3-parallel scheduler, cap, stop, delete. |
| 7. Measurement | Instruction extraction, followed check, counterfactual replay, influence, measured leader, style labels. |
| 8. Results & export | Per-run and per-experiment results pages, group comparison, CSV/JSON export. |
| 9. Sharing, demos & admin | Public run links, landing-page demo gallery, admin panel for demos and global settings. |
| 10. Production hardening | Restart recovery, limits, error states, smoke test on production with a real key. |

---

## Milestone: 1. Skeleton & deploy

### Changes

Create `backend/` (FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, pytest) and `frontend/` (Vite React TS, react-router, zustand, three, @react-three/fiber, @react-three/drei), plus a Caddy-served frontend that proxies `/api` and `/ws` to the backend. Deploy both to Railway with a Postgres plugin before any feature work.

### Commits (in order)

- `chore: init monorepo with backend and frontend apps`: git init, `.gitignore`, `backend/pyproject.toml`, `frontend/` from the Vite React-TS template.
- `feat(backend): add FastAPI app with health endpoint and settings`: `app/main.py`, `/api/health`, `app/config.py` reading `DATABASE_URL`, `ENCRYPTION_KEY`, `JWT_SECRET` from env.
- `feat(backend): add database models and first Alembic migration`: all tables listed in Notes, created in one migration.
- `feat(frontend): add router, layout shell and API client`: pages stubbed, `fetch` wrapper with `credentials: "include"`.
- `chore: add Dockerfiles, Caddyfile and Railway config`: backend Dockerfile runs `alembic upgrade head && uvicorn`; frontend Dockerfile builds Vite and serves `dist/` with Caddy, reverse-proxying `/api/*` and `/ws/*` to `backend.railway.internal:8000`.
- `chore: add per-service railway.json with watch paths`: `backend/railway.json` watches `backend/**` and `frontend/railway.json` watches `frontend/**`, so a push only redeploys the service whose files changed.

### Notes

- **One repo, auto-deploy on push.**
  - **Repo.** A single GitHub repo. In Railway, connect both the frontend and backend services to the same repo, with Root Directory `backend/` and `frontend/` respectively.
  - **Deploys.** Each service auto-deploys on every push to `main` (Railway's GitHub integration; no GitHub Actions needed).
  - **Watch paths.** The watch paths in each `railway.json` mean that changing only `frontend/` does not redeploy the backend, and vice versa.
  - **Postgres** is a Railway database service, not deployed from the repo. Schema changes ship with the backend, because its start command runs `alembic upgrade head` first.
  - **Connecting the repo to Railway** is a one-time manual step in the Railway dashboard, done by the user. Railway needs GitHub access to the repo.

- **Same origin on purpose.** `*.up.railway.app` subdomains count as different sites, so cross-site cookies would break. Caddy in the frontend service proxies the API, so the browser only ever talks to one origin and the auth cookie is first-party.
- **Tables** (one migration):
  - `users`: id, email (unique, lowercased), password_hash, is_admin bool default false, created_at.
  - `api_keys`: user_id PK/FK, provider ('anthropic'), ciphertext, last4, created_at.
  - `global_settings`: a single row with `data` JSONB.
  - `experiments`: id, user_id, name, config JSONB (a full snapshot including global settings), status, spent_usd, cap_usd, is_demo, created_at, finished_at.
  - `runs`: id, experiment_id, group ('none' | 'free' | 'directive' | 'nondirective' | 'solo'), layout_no, status, started_at, ended_at, end_reason, cost_usd, share_token nullable unique, result JSONB.
  - `run_events`: run_id, seq, t_ms, type, payload JSONB; PK is (run_id, seq).
  - `decisions`: id, run_id, agent, seq, t_ms, trigger, request JSONB (the exact `messages` + system sent), response JSONB, outcome ('ok' | 'invalid' | 'skipped_chose'), input_tokens, output_tokens, cost_usd.
- Python 3.12, `anthropic` SDK (latest 1.x), `pwdlib[argon2]`, `cryptography` (Fernet), `pyjwt`.
- The project folder is not a git repo yet; the first commit does `git init`. The user's rule: no `Co-Authored-By` trailer in commit messages.

### Goal Metrics

- Production URL shows the frontend shell; `GET /api/health` through the frontend origin returns `{"ok": true}`.
- `alembic upgrade head` runs on deploy with no errors; all tables exist in Railway Postgres.
- `pytest` runs (empty suite passes) in CI or locally.
- A push to `main` that only changes `frontend/` triggers a frontend deploy and no backend deploy (check the Railway deploy list); the same check from the backend side.

---

## Milestone: 2. Auth & API key

### Changes

Email + password signup/login/logout with a JWT in an httpOnly, `SameSite=Lax`, `Secure` cookie, and a `get_current_user` dependency. API key endpoints: save (validate with a tiny test call, then encrypt with Fernet), get (last 4 only), delete.

### Commits (in order)

- `feat(auth): add signup, login, logout and current-user endpoints`: argon2 hashing; email lowercased and unique; password minimum 8 characters; generic error on bad login.
- `feat(auth): add login and signup pages with session state`: frontend forms and a `useMe()` hook; logged-out users are redirected to login on private routes.
- `feat(keys): add encrypted Anthropic key storage with test call`: `PUT /api/key` makes a 1-token `messages.create` on `claude-haiku-5-5`; on `AuthenticationError` it returns 400 "Invalid key"; on success it stores the ciphertext and last4. Also `GET /api/key` and `DELETE /api/key`.
- `feat(keys): add API key settings page and first-login prompt`: shows `sk-ant-…abcd`, Replace and Delete buttons; the New-experiment button stays disabled without a key.

### Notes

- Admin is set by hand: `UPDATE users SET is_admin = true WHERE email = '...'`. No admin UI for roles.
- The decrypted key lives only in memory, inside the run worker. Never log it, never return it, never put it into events.
- Deleting the key must stop the user's running experiments (milestone 6 checks `api_keys` before every LLM call batch; see Notes there).
- No email verification and no password reset (product decision).

### Goal Metrics

- `test_signup_login_logout`: cookie set, `/api/me` returns the user, logout clears it.
- `test_duplicate_email_rejected`, `test_wrong_password_generic_error`.
- `test_key_roundtrip_encrypted`: the DB column is not equal to the plaintext; GET returns only last4; DELETE removes the row. The Anthropic call is mocked.
- Manual check: saving a garbage key shows "Invalid key"; saving a real key shows its last 4 characters.

---

## Milestone: 3. Game engine

### Changes

A pure-Python package `backend/app/game/` with no DB or LLM imports. It contains:

- the layout generator, seeded by layout number;
- a real-time simulation driven by an injectable clock;
- move/flip actions, chair locking, budgets;
- goal checks and end conditions;
- an append-only event list that fully describes the run for playback.

It is tested with scripted agents.

### Commits (in order)

- `feat(game): add board model, goal checks and minimum-actions solver`: `board.py` defines 8x8 cells, zones and chairs. `goals.py` holds the four checks. `solver.py` computes the minimum actions: 8 flips + (8 − max chairs already on any of the 16 ring placements).
- `feat(game): add seeded layout generator constrained to 14-16 actions`: `layouts.py`: `layout(n)` uses `random.Random(n)` to place chairs and agent cells, assign goals, permute the budget and pick the leader (from separate sub-seeds). It rejection-samples until the solver says 14–16.
- `feat(game): add real-time engine with walking, move, flip and locking`: `engine.py` holds per-agent state (idle, walking_to_chair, carrying, flipping), the path (x then y, one cell per `cell_seconds`), take-on-arrival, the ruling that the first arrival wins (random tie), drop only on an empty cell, and a budget charged on take.
- `feat(game): add decision API and end conditions`: `apply(agent, decision)` validates and starts the action. End states are `solved`, `budget_exhausted`, `all_waiting`, `time_limit`, `call_limit`.
- `feat(game): add event log and state reconstruction`: every change emits `{seq, t_ms, type, payload}`, and `replay(events, t)` rebuilds the board. These are the same events the frontend uses.
- `test(game): add engine, goal and layout tests with scripted agents`

### Notes

- **Goals:**
  - *circle*: every chair has exactly 2 orthogonal chair-neighbours and the chairs are connected. On a grid with 8 chairs, the only match is a 3x3 ring with an empty centre.
  - *upside down*: all chairs flipped.
  - *one zone*: all chairs in the same 4x4 zone.
  - *touching*: the chairs are orthogonally connected.
- **Decisions** (the same shape the LLM returns in milestone 5):
  - `move(chair, cell)`.
  - `flip(chair)`.
  - `put_down`.
  - `continue`.
  - `wait`: stop walking. The agent keeps any chair it holds.
- **Edge cases:**
  - **`move(X, Y)` while holding X** carries X to Y at no new cost.
  - **`move` or `flip` of another chair while holding one** is invalid unless the current cell is empty; if it is empty, the held chair is put down first, then the action starts.
  - **Arriving at the target chair:**
    - If someone else holds it: the agent stops, triggers `chair_taken(by=…)` and is charged nothing.
    - If the agent has budget 0: the action is invalid, which is checked at decision time.
  - **Arriving at an occupied drop cell** keeps the chair and triggers `cell_occupied`.
  - **Flip** locks the chair for `flip_seconds` (default 2) and then toggles `upside_down`.
  - **Agents and chairs never block paths.**
- **End conditions:**
  - **`all_waiting`:** every agent is idle and its last decision was `wait`/`continue`, with no state-changing event across one full heartbeat (10 s).
  - **`budget_exhausted`:** every budget is 0 and no chair is held.
- **Clock.** The clock is injectable (`now()` + `sleep()`), so tests run instantly with a fake clock. The engine ticks every 100 ms of game time.
- **Solo baseline** uses the same engine with 1 agent that has all 4 goals and the sum of the budgets. The 12-per-agent rule does not apply to it.
- **Leader and budget come from the layout seed.** The leader and the budget permutation are derived from `layout_no`, so layout i gives the same leader and the same dealing in every group and every experiment. That makes groups and experiments comparable.

### Goal Metrics

- `test_goals_ring_detected` / `test_goals_2x4_block_not_circle`.
- `test_zone_and_touching_checks`.
- `test_layout_deterministic`: `layout(7) == layout(7)`.
- `test_layouts_1_to_200_in_14_16_range`.
- `test_first_arrival_takes_chair`, `test_tie_random_but_seeded`.
- `test_drop_on_occupied_cell_keeps_chair`.
- `test_budget_charged_on_take_not_on_order`.
- `test_zero_budget_can_put_down`.
- `test_flip_locks_chair`.
- `test_scripted_team_solves_layout_1`: a perfect-play script reaches `solved` within the minimum actions.
- `test_replay_matches_final_state`.

---

## Milestone: 4. Live view & 3D room

### Changes

Add the WebSocket `/ws/runs/{id}`, which sends a snapshot (all events so far) and then streams new events. Add a dev-only "scripted bots" run mode so the viewer can be built with zero API spend. Frontend: the run viewer page with:

- the r3f 3D room;
- the chat panel and agent panel;
- live mode and playback mode (timeline, pause, 1x/2x/4x).

All of it is built on one event reducer.

### Commits (in order)

- `feat(ws): add run event broadcast hub and websocket endpoint`: an in-memory `dict[run_id, set[queue]]`. On connect it sends the events stored so far in the DB (from `run_events`), then the live ones. Access is checked: owner, public share token, or demo run.
- `feat(dev): add scripted-bot run launcher for local development`: `POST /api/dev/scripted-run`, enabled only when `ENV=dev`.
- `feat(viewer): add event reducer and playback clock`: `frontend/src/run/reducer.ts` turns `(events, t)` into the board state and per-agent tweens (walk segments carry start/end time, and the frontend lerps between them).
- `feat(viewer): add 3D room with zones, chairs and walking agents`: low-poly floor with 4 zone colours, chairs built from boxes (rotated 180° when upside down), capsule agents with name labels, carry/flip animations and `drei` `Html` speech bubbles.
- `feat(viewer): add chat panel, agent panel and notes toggle`
- `feat(viewer): add playback timeline with pause and 1x/2x/4x`: a finished run loads all events via REST `GET /api/runs/{id}/events`, uses the same reducer, and the playback clock is scaled.

### Notes

- **Event types:**
  - `run_started`
  - `agent_walk`: from, to, t_start, t_end.
  - `chair_taken`, `chair_dropped`, `flip_started`, `flip_done`
  - `message`: agent, text.
  - `notes`: agent, text, viewer-only.
  - `decision`: agent, kind, trigger, outcome.
  - `budget`: agent, left, viewer-only.
  - `run_ended`: reason, goals met.
- **Viewer-only data.** Viewers see goals, budgets, notes and the leader marker. Agents never receive viewer-only data; that is enforced in milestone 5, not in the UI.
- **Several runs at once.** If several runs play together, the experiment page lists them and the user clicks one to open the viewer.
- **Reconnects.** On WebSocket reconnect the client sends the last seq and the server resends the gap from the DB.
- **Placeholders.** Style tags and highlighted instructions show placeholders until milestone 7 fills `runs.result`.

### Goal Metrics

- `reducer.test.ts` (vitest): state at time t from a fixture event log equals the expected board; seeking backwards works.
- `test_ws_snapshot_then_live`: a client that connects mid-run gets all earlier events and then new ones in order, with no gaps or duplicates.
- `test_ws_rejects_other_users_run`.
- Manual: a scripted run animates walking, carrying and flipping smoothly; the playback of the same run looks identical; 4x is 4 times faster.

---

## Milestone: 5. LLM agents

### Changes

Add `backend/app/agents/`:

- a neutral system prompt (rules, own goal, own budget; plus the leader line only for the leader agent);
- an observation builder: the board as a text grid plus a chair list, the agent's notes, the chat so far, and what happened since the agent's last decision;
- a structured decision schema;
- a per-agent async loop. It wakes on triggers or on the 10 s heartbeat, keeps one call in flight, retries an invalid answer once, and records every request/response in `decisions` with its cost.

### Commits (in order)

- `feat(agents): add prompts, observation builder and decision schema`: a Pydantic `Decision` with action enum, chair, cell, message (≤300 chars), notes. The prompt avoids the words leader, team, coordinate and manager, except in the leader line.
- `feat(agents): add per-agent decision loop with triggers and heartbeat`: an `asyncio.Event` per agent, set by engine events (action done, arrival, cell occupied, chair taken, new message, take/release by others). Events that happen during a call are queued into the next observation.
- `feat(agents): call Claude with structured output and retry on invalid`: `AsyncAnthropic(api_key=…, max_retries=5)`; `client.messages.parse(model=…, output_format=Decision, output_config={"effort": "low"}, …)`. On a parse or validation failure the agent is asked once more, then gets `skipped_invalid`.
- `feat(agents): add token cost accounting and call limit`: a price table per model. The cost is added to the run and the experiment. Once an agent reaches 60 calls, the `call_limit` end condition fires.
- `test(agents): add prompt neutrality and loop tests with a fake client`

### Notes

- **Models and prices** (USD per 1M tokens, input/output):
  - `claude-haiku-5-5`: $0.10 / $0.50, up to 100K prompt tokens. This is the default.
  - `claude-sonnet-5-5`: $2 / $10.
  - `claude-opus-5-5`: $4 / $20.
- **No temperature parameter.** These models reject a custom `temperature`, and from API version 2026-10-21 every model does. Their default sampling is already random, which is what the counterfactual replay needs. Do not send `temperature`.
- **No forced `tool_choice`.** It returns 400 on Sonnet/Opus 5.5. Use structured outputs (`messages.parse` + `output_format`) instead.
- **Thinking.** Thinking stays on (it can't be disabled on Opus 5.5). Use `effort: "low"` for speed and cost. Admins can change it via global settings (milestone 9).
- **No assistant prefill** (400 on these models).
- **Agents never see:**
  - other agents' goals (unless "Agents know all goals" is on);
  - other agents' budgets;
  - other agents' notes;
  - other agents' destinations;
  - who the leader is.

  `test_observation_hides_private_fields` guards this.
- **Store the exact request.** `decisions.request` stores the exact `system` + `messages` sent. Milestone 7 replays these with one chat message removed, so the observation must keep the chat as a separate, removable block, one line per message with a stable id.
- **Errors:**
  - `AuthenticationError` or `PermissionDeniedError` (bad key or no credit): stop the experiment.
  - 429/529: the SDK retries 5 times with backoff, then the decision is skipped as invalid.
  - Look up the exact exception classes in the claude-api skill `shared/error-codes.md`.
- **Model check.** Before coding, re-check model IDs/prices with `client.models.retrieve` or the claude-api skill. The cached table is from 2026-10-06.

### Goal Metrics

- `test_prompt_has_no_leadership_words` (non-leader agents), `test_leader_prompt_variants`.
- `test_observation_hides_private_fields`.
- `test_one_call_in_flight_per_agent`: 5 triggers during one slow fake call result in exactly 1 follow-up call that contains all 5 events.
- `test_invalid_then_valid_retry` / `test_invalid_twice_skipped_no_cost_to_budget`.
- `test_auth_error_stops_run`.
- `test_cost_accumulates_from_usage`.
- Manual: one real Haiku run on layout 1 plays to an end state; decisions look sensible; real cost is shown.

---

## Milestone: 6. Experiments & scheduler

### Changes

- **Form and endpoints.** The create-experiment form and `POST /api/experiments` validate the budget (4 integers, each ≤ 12, sum ≥ 16), runs 1–25, the model and the cap. They snapshot the global settings into `config`.
- **Rows created up front.** All `runs` rows are created at once: N per group (4 groups if a leader is added) plus N solo runs if solo baseline is on. Run i uses layout i.
- **Scheduler.** An in-process scheduler plays at most 3 runs at a time per experiment and enforces the cap.
- **Controls.** Stop / Delete, experiment list and experiment page with status and progress.

### Commits (in order)

- `feat(experiments): add create endpoint with validation and config snapshot`
- `feat(experiments): add cost estimate endpoint`: `runs × groups × calls_per_run_estimate × avg tokens × model price`, plus the measurement estimate. The constants are kept in one place.
- `feat(experiments): add in-process run scheduler with 3 parallel runs`: one asyncio task per experiment pulls queued runs (ordered by layout_no, then group) through a `Semaphore(3)`. Run status moves queued → running → measuring → finished, or failed.
- `feat(experiments): enforce spending cap, key deletion and stop`: before each LLM call, check `experiment.stop_requested`, `spent_usd < cap_usd` and that the key still exists. If any fails, cancel the in-flight runs (mark them `stopped`) and keep the finished ones.
- `feat(experiments): add create form, experiment list and experiment page`: the form shows "4 groups will run" when a leader is added, a live cost estimate, and a cap defaulting to $5. The experiment page polls every 3 s or uses the WS for status.
- `feat(experiments): add delete with cascade`: delete removes runs, events and decisions; a running experiment is stopped first.

### Notes

- **One backend replica.** The scheduler lives in the backend process (no Redis or queue). `# ponytail: in-process scheduler, single replica only; move to a DB-polled worker service if Railway needs >1 replica.`
- **Cap.** The cap is checked before every call, so it may overshoot by at most the calls already in flight, about 12. That is fine.
- **Groups.** The leader groups use the leader picked from the layout seed. The 'none' group on the same layout is the comparison.
- **Per-run record.** Each run records `leader_is_richest` in `result`; results can be filtered by it.
- **Tab closed.** Runs keep going when the tab closes, because nothing depends on the WebSocket.

### Goal Metrics

- `test_budget_validation` (13 rejected, sum 15 rejected, 12/4/0/0 accepted).
- `test_leader_creates_4_groups_x_n_runs`.
- `test_solo_adds_n_runs`.
- `test_max_3_runs_parallel` (fake engine).
- `test_cap_stops_experiment_keeps_finished`.
- `test_key_delete_stops_experiment`.
- `test_stop_marks_running_stopped`.
- Manual: launching a 2-run Haiku experiment shows progress, money spent, then finished.

---

## Milestone: 7. Measurement

### Changes

After a run ends (status `measuring`), `backend/app/measure/` does the following:

1. **Labels each chat message.** One structured call per message, on the experiment's model, extracts the style (directive / non-directive / other) and an optional instruction: one named recipient plus one concrete action (move or flip, chair, optional cell).
2. **Checks followed instructions.** An instruction counts as followed if the recipient's next 2 decisions after the message match it.
3. **Re-runs followed instructions.** For each followed instruction, it re-runs that decision request 3 times with the message and 3 times without it.
4. **Scores influence.** It computes influence, the measured leader, the influence shares and boss-vs-workhorse.
5. **Saves.** It stores everything in `runs.result`.

### Commits (in order)

- `feat(measure): add message labelling with instruction extraction`: a Pydantic `MessageLabel`. Unnamed recipients ("someone") give no instruction. All messages in a run are labelled concurrently (limit 4).
- `feat(measure): add followed check against decision log`: the instruction and the decision must agree on action type and chair. The cell must match too when the instruction named one.
- `feat(measure): add counterfactual replay and influence scores`: drop the message line from the stored request, then score `max(0, hits_with/3 − hits_without/3)`. An agent's influence is the sum of its scores.
- `feat(measure): add measured leader, shares and style mix`: the leader needs ≥ 2 distinct followers, influence ≥ `min_influence` (default 0.5), and strictly the highest. Otherwise there is no leader.
- `test(measure): add scoring and leader-rule tests`

### Notes

- **Measurement costs money.** It uses the user's key and counts toward the cap; the cost estimate includes it. If the cap is hit during measurement, the run is saved with `result.partial = true`.
- **Replays reuse stored requests.** The replays reuse `decisions.request` exactly, minus one chat line. That is why milestone 5 must keep chat lines separable. The "with" replays re-sample the decision; we do not reuse the original answer as one of the 3.
- **Thresholds.** `min_influence` and the 25% chance line are constants in `measure/config.py`. Statistical tests are out of scope; the data goes to export.
- **Validation.** The manual extractor check on 60 messages happens outside the platform, using the export.

### Goal Metrics

- `test_unnamed_instruction_ignored`.
- `test_followed_within_two_decisions` / `test_not_followed_on_third`.
- `test_influence_never_negative`.
- `test_leader_requires_two_followers`, `test_leader_requires_strict_max`, `test_no_leader_below_threshold`.
- `test_shares_sum_to_one`.
- `test_replay_removes_exactly_one_message`.
- Manual: on one real run, the labels on 10 messages look right and an obvious "Bo, flip chair 2" that Bo then did shows up with influence > 0.

---

## Milestone: 8. Results & export

### Changes

The run results panel shows:

- solved / time;
- the measured leader and influence shares against 25%;
- the instructions table;
- the style mix;
- the richest agent's influence given vs received;
- for leader runs, whether the leader became the measured leader and whether it was the richest.

The experiment results page shows the leader rate, solve rate, average length, how often the leader was the richest (against 25%), the 4 groups side by side when a leader was added, a `leader_is_richest` filter, and CSV/JSON export.

### Commits (in order)

- `feat(results): add run results API and panel`: the chat panel now shows style tags and highlighted instructions with followed/not followed.
- `feat(results): add experiment aggregates API and page`: simple bar charts made with plain SVG/CSS (no chart library).
- `feat(results): add group comparison and leader-is-richest filter`
- `feat(export): add CSV and JSON export`: JSON is the full experiment (config, runs, results, events, decisions without the API key). CSV is one row per run plus one row per message, as two files in a zip.

### Notes

- Aggregates are computed on request from `runs.result`. No materialised tables (25 × 5 runs at most).
- Runs that are stopped or partial are shown but excluded from rates, with a counter.

### Goal Metrics

- `test_aggregates_fixture`: a hand-made set of 4 runs gives the expected solve rate, leader rate and richest-leader rate.
- `test_export_contains_no_key`.
- Manual: the export opens in a spreadsheet; the group comparison shows 4 columns for a leader experiment.

---

## Milestone: 9. Sharing, demos & admin

### Changes

- **Share links.** The owner can create or revoke a public token for one run; `/r/{token}` shows playback and results read-only.
- **Admin panel** (`is_admin` only):
  - mark own experiments as demos;
  - edit `global_settings`: walking speed, flip time, the time and call limits, budget limits, max runs, parallel runs, available models, effort.
- **Landing page.** It lists demo experiments and their runs, viewable without an account.

### Commits (in order)

- `feat(share): add public run share token and read-only page`
- `feat(admin): add admin guard, global settings API and page`: new experiments snapshot the settings; running ones keep their own.
- `feat(admin): add demo toggle on own experiments`
- `feat(landing): add landing page with demo gallery`

### Notes

- Public endpoints return only that run (or the demo experiments) and never user emails or key info.
- Admins cannot list other users' experiments. There is no endpoint for it.
- **Cut order if time is short:** demo gallery, then share links, then solo baseline. The game, the 3D view and the measurement are never cut.

### Goal Metrics

- `test_share_token_grants_only_that_run`, `test_revoked_token_404`.
- `test_non_admin_403_on_settings`.
- `test_settings_snapshot_not_retroactive`.
- `test_demo_visible_logged_out`.
- Manual: an incognito window opens a share link and plays the run.

---

## Milestone: 10. Production hardening

### Changes

- **Restart recovery.** On backend startup, runs left `running` or `measuring` are marked `failed` (reason `server_restart`) and their experiments continue with the next queued run.
- **Limits and safety.** Add basic rate limits on auth, request size limits, and a global cap on concurrent runs across all users.
- **Smoke test.** A production smoke test with a real key.

### Commits (in order)

- `feat(ops): recover interrupted runs on startup`
- `feat(ops): add login rate limit and global concurrency cap`: a simple in-memory per-IP limit on `/api/auth/*`. The global run cap (default 30) is in global settings.
- `fix: polish error, empty and loading states`: no key, failed run reasons, stopped experiment, measuring spinner.
- `docs: add README with local setup, env vars and deploy steps`

### Notes

- **Env vars:**
  - `DATABASE_URL`
  - `ENCRYPTION_KEY`: Fernet; losing it makes stored keys unreadable, and users must re-enter them.
  - `JWT_SECRET`
  - `ENV`
- **Backups.** Railway Postgres backups are on.
- `# ponytail: in-memory rate limit and WS hub, single replica; move to Postgres/Redis if scaling out.`

### Goal Metrics

- `test_startup_marks_interrupted_runs_failed`.
- `test_login_rate_limited`.
- **Production smoke:**
  1. sign up, add a key, launch a 1-run Haiku experiment with a leader (4 runs);
  2. watch one live;
  3. after it finishes, see the results and the group comparison;
  4. export;
  5. share link in incognito;
  6. delete the experiment.
- **Real cost** of a Haiku run is within ±50% of the estimate (otherwise retune the constants).

---

## Additional Notes

- **Source of truth for behaviour.** All game, budget, leader, measurement and UX rules are in [product-overview.md](product-overview.md). Read it before any milestone. Two deviations:
  - **Temperature.** Haiku 5.5, Sonnet 5.5 and Opus 5.5 reject a custom temperature, and API version 2026-10-21 rejects it on every model. The product doc lists "temperature 1.0, adjustable by admins". Instead, the platform sends no temperature (the default sampling is random, which is what the replays need), and the admin setting is **effort** (default `low`). Update the product doc to match.
  - **Followed check.** "Followed within next 2 decisions" counts only decisions that produce an action (`move`, `flip`, `put_down`).
- **Architecture:**
  - one backend process holds the engine, the agent loops, the scheduler, the WS hub and the measurement, all on asyncio;
  - Postgres is the only store;
  - the frontend is a static SPA behind Caddy, with a same-origin proxy.

  There is no Redis, no Celery and no separate worker. That is fine at this scale; each simplification is marked with a `ponytail:` comment.
- **One event log, two consumers.** The engine's event list is both the live WS stream and the playback source. Never add a viewer-only code path that bypasses events.
- **Comparability.** Layout i, its budget dealing and its leader all come from seed i. Changing `layouts.py` breaks comparability with old experiments, so store `layout_version` in the experiment config and bump it on any change.
- **Risks:**
  - **Rate limits.** 3 parallel runs × 4 agents means up to 12 concurrent calls on a fresh Anthropic key, which can hit low-tier rate limits. Backoff handles it, but games then slow down. Mention it in the UI if 429s happen.
  - **Model check.** Re-check model IDs and prices before milestone 5 (the claude-api skill or the Models API).
  - **Measurement cost.** Measurement can cost as much as the game on chatty runs. The estimate must include it.
  - **Deadline.** The user wants this live by 2026-11-08. If time runs out, cut by the order in milestone 9 Notes.
- **Workflow.** The user prefers a no-commit/no-push workflow (marceta-code). The commits here are the logical units; ask before actually committing. Never add a `Co-Authored-By` trailer.
