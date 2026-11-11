<div align="center">

# Agents Leader Lab

### Who leads when no agent is in charge?

A research sandbox for testing how leadership emerges in teams of AI agents that have no boss.

[**Open the lab**](https://frontend-production-ccea.up.railway.app) · [Watch the demo run](https://frontend-production-ccea.up.railway.app/#demo) · [API and data contracts](docs/contracts.md)

![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square)
![React](https://img.shields.io/badge/frontend-React%2019-61dafb?style=flat-square)
![three.js](https://img.shields.io/badge/3D-three.js-1c1838?style=flat-square)
![Claude](https://img.shields.io/badge/agents-Claude-d97757?style=flat-square)
![Railway](https://img.shields.io/badge/hosted%20on-Railway-7b3fe4?style=flat-square)

</div>

---

## Why this exists

More and more work is split among AI agents that answer to different teams. Picture one software project where four
teams each deploy an agent: one builds a feature, one keeps the tests passing, one fixes security issues, one keeps the
docs current. The goals fit together, but all four agents change the same code, and **nobody put any of them in
charge**.

Agent systems built by one team usually have an orchestrator or a manager. Here there is none, so any leadership that
appears is **emergent**. That is not harmful in itself, but it is influence nobody planned: a leader's mistakes spread
through the group, and oversight built around the designed structure does not see it.

The lab exists to learn **what causes emergent leadership**, so the people deploying agents can anticipate it instead of
discovering it afterwards.

<table>
<tr>
<td width="33%" valign="top">

### When
**does a leader appear?**

Agents that know only their own goal, against agents that know everyone's goals.

</td>
<td width="33%" valign="top">

### Who
**becomes the leader?**

Does the agent with the largest action budget lead more often than chance (25% with four agents)?

</td>
<td width="33%" valign="top">

### How
**does it lead?**

Directive (decide and assign) against non-directive (frame, propose, ask, summarise).

</td>
</tr>
</table>

> The example study was done at the **Apart Swarm hackathon**.

---

## The Chair Game

Every experiment plays the same small game. It is simple enough to check automatically and open enough that the agents
have to talk to get anywhere.

| | |
|---|---|
| **The room** | An 8 x 8 floor in four coloured zones, with eight numbered chairs. It stands in for a shared codebase: everyone works on the same things. |
| **The agents** | Sam, Sky, Sol and Sage. Each gets its own goal, such as *"Turn all the chairs upside down"*, and its own budget of actions. Names are shuffled every run. |
| **Real time** | No turns. Agents walk, carry a chair to a new cell or flip it where it stands, while the others keep moving. Each move or flip costs one action. |
| **One chat** | A single shared chat is the only way to agree on anything. Each agent also keeps private notes as its memory. |
| **The end** | All goals met, all actions spent, every agent waiting, only talk and no action (gridlock), ten minutes passed, or an agent asked 30 times. |

The four built-in goals (*square*, *upside down*, *one zone*, *touching*) only look like they clash: one hollow square of
upside-down chairs in the named zone meets all four.

```mermaid
flowchart LR
    A["Agent is asked<br/>(new message, action done,<br/>chair taken, 10 s quiet)"] --> B["Claude reads the room,<br/>the chat and its notes"]
    B --> C{"Answer"}
    C -->|move / flip| D["Walks, takes the chair,<br/>spends 1 action"]
    C -->|message| E["Posts in the shared chat"]
    C -->|wait / continue| F["Keeps doing what it does"]
    D --> G["Room changes"]
    E --> G
    G --> A
```

---

## How influence is measured

A leader is the agent whose messages **measurably change what the others do**, not the one that talks most or calls
itself one. Every finished run is measured in three steps.

```mermaid
flowchart LR
    L["1 · Label<br/>Every chat message: style,<br/>requests to named agents,<br/>proposed target cells"] --> T["2 · Find followers<br/>Did the recipient do it<br/>in its next 2 actions?<br/>Did it adopt the plan?"]
    T --> R["3 · Replay 5 + 5<br/>Same decision, 5 times with<br/>the message, 5 times without"]
    R --> S["Influence =<br/>with − without"]
```

- **What gets tested:** instructions to a named agent (or to everyone) about one specific chair, prohibitions to a named
  agent, and plans with exact cells that another agent adopts.
- **Credit only for real influence:** if the follower would have done the same anyway, the message gets no credit. A test
  that cannot be run is recorded as *missing* with a reason, never as zero.
- **Primary outcome:** each agent's **share of all influence** in a run, against the 25% chance line. The share of the
  agent told to lead, or of the richest agent, is the headline number.
- **Measured leader:** the top agent, with influence of at least 0.5, at least 0.5 ahead of the next agent, and at least
  one follower (a stricter count asks for two).

Full rules, with every edge case, are in [`backend/app/measure/run.py`](backend/app/measure/run.py) and
[`docs/contracts.md`](docs/contracts.md).

---

## What you can vary

Change one condition, keep the rest. Every run plays a numbered layout, so groups compare on the same rooms.

| Available now | |
|---|---|
| **Goals** | The four built-in goals, or your own goal for any agent |
| **Prompts** | Edit just an agent's goal, or rewrite everything it is told about itself; read the full rules |
| **Budgets** | Equal actions for all, or one agent far richer than the rest (the rich role rotates across layouts) |
| **Who knows what** | Each agent knows only its own goal, or everyone knows all goals |
| **Leader style** | No leader, or one agent told to lead, directive or non-directive, in your own words |
| **Model** | Claude Haiku, Sonnet or Opus |

| Coming soon | |
|---|---|
| **Team size** | 1 to 8 agents, then larger groups across several channels |
| **More models** | Beyond the three Claude models |
| **Editable rules** | Change the rules every agent gets, not only read them |
| **Network structure** | A star, a hierarchy, or bridge agents between groups |
| **Private messages** | One-to-one messages beside the shared chat |
| **Priced talk** | Messages and actions paid from one credit budget |
| **Knowledge vs budget** | A dossier of notes for one agent, against a larger budget |
| **Claimed vs real advantage** | Does an agent take charge by claiming a budget it does not have? |

---

## Using the lab

1. **Sign up** and add your own Anthropic API key. It is stored encrypted, and you pay Anthropic directly for every call.
2. **Create an experiment:** pick the conditions, the number of runs, the model and a spending cap. The form shows the
   estimated cost before you launch.
3. **Watch it live:** each run plays in a 3D room with the chat beside it. Pause, resume or stop the experiment at any time.
4. **Read the results:** each run is measured a minute or two after it ends. The experiment page shows the influence
   shares, the measured leaders, message styles and, with a leader, both groups side by side. Export everything as JSON
   or CSV.

---

## Architecture

```mermaid
flowchart LR
    U["Browser<br/>React 19 · Vite · three.js"] --> C["Caddy<br/>static site + proxy"]
    C -->|/api, /ws| B["FastAPI<br/>game engine · runner<br/>scheduler · measurement"]
    B --> D[("PostgreSQL")]
    B --> A["Anthropic API<br/>(user's own key)"]
```

| Part | What it does |
|---|---|
| `backend/app/game` | The pure game engine: room, goals, layouts, solver and the real-time `tick` loop |
| `backend/app/agents` | Prompts, what each agent sees per decision, and the Claude calls |
| `backend/app/runner.py` | Plays one run: asks agents when they have something new, applies their answers, streams events |
| `backend/app/scheduler.py` | Queues runs, limits how many play at once, pause / resume / stop |
| `backend/app/measure` | Labelling, follower tests, replays and the influence scores |
| `frontend/src/run` | The 3D room, chat, timeline and replay |
| `frontend/src/pages` | Landing, experiment form, experiment results, admin |

Deployed on Railway as three services: frontend (Caddy), backend (FastAPI) and Postgres.

---

## Run it locally

You need [uv](https://docs.astral.sh/uv/) and Node.js.

```bash
cd backend
uv run uvicorn app.main:app --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` and `/ws` to the backend, and the backend uses a local SQLite
file, so no other setup is needed.

Tests:

```bash
cd backend
uv run pytest
```

```bash
cd frontend
npx vitest run
```

---

## Documentation

- [`docs/contracts.md`](docs/contracts.md): the API, the run events, the result format and the measurement rules
- [`docs/design.md`](docs/design.md): the visual design system

<div align="center">
<sub>Built for research on emergent leadership in multi-agent AI systems.</sub>
</div>
