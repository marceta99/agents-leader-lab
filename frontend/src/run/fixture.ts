// Hand-scripted event log for tests and the /runs/demo page. Follows docs/contracts.md "Events" exactly.
// The script tracks positions so every agent_step is one orthogonal cell (x first, then y).
import type { Cell, EventType, RunEvent, RunInfo, RunResult } from './types'

const CELL = 2000
const FLIP = 2000

type Draft = Omit<RunEvent, 'seq'>
const raw: Draft[] = []
function push<K extends EventType>(t: number, type: K, data: Extract<RunEvent, { type: K }>['data']) {
  raw.push({ t, type, data } as Draft)
}

const pos: Record<string, Cell> = { Sam: [0, 0], Sky: [7, 0], Sol: [0, 7], Sage: [7, 7] }
const budget: Record<string, number> = { Sam: 5, Sky: 6, Sol: 4, Sage: 5 }
const decN: Record<string, number> = { Sam: 0, Sky: 0, Sol: 0, Sage: 0 }
let msgId = 0

/** Emit steps from the agent's cell to `to`; stops early (no step starting at/after `until`). Returns arrival time. */
function walk(agent: string, to: Cell, t0: number, until = Infinity): number {
  let t = t0
  const axes: (0 | 1)[] = [0, 1]
  for (const ax of axes) {
    while (pos[agent][ax] !== to[ax]) {
      if (t >= until) return t
      const from: Cell = [...pos[agent]]
      const next: Cell = [...from]
      next[ax] += Math.sign(to[ax] - from[ax])
      push(t, 'agent_step', { agent, from, to: next, dur_ms: CELL })
      pos[agent] = next
      t += CELL
    }
  }
  return t
}
function decide(t: number, agent: string, kind: string, chair: number | null = null, cell: Cell | null = null, outcome = 'ok') {
  push(t, 'decision', { agent, n: ++decN[agent], kind, chair, cell, outcome, reason: null })
}
function say(t: number, agent: string, text: string) {
  push(t, 'message', { agent, id: ++msgId, text })
}
function take(t: number, agent: string, chair: number, kind: 'move' | 'flip') {
  push(t, 'chair_taken', { agent, chair, for: kind, budget_left: --budget[agent] })
}
function flip(t: number, agent: string, chair: number, upside_down: boolean): number {
  take(t, agent, chair, 'flip')
  push(t, 'flip_started', { agent, chair, dur_ms: FLIP })
  push(t + FLIP, 'flip_done', { agent, chair, upside_down })
  return t + FLIP
}
/** Walk to the chair, take it, carry it to `dest`, drop. Returns drop time. */
function move(t: number, agent: string, chair: number, at: Cell, dest: Cell): number {
  t = walk(agent, at, t)
  take(t, agent, chair, 'move')
  t = walk(agent, dest, t)
  push(t, 'chair_dropped', { agent, chair, cell: dest })
  return t
}

const NONE = { square: false, upside_down: false, one_zone: false, touching: false }

push(0, 'run_started', {
  layout_no: 3,
  group: 'directive',
  grid: 8,
  cell_ms: CELL,
  flip_ms: FLIP,
  time_limit_ms: 600_000,
  know_all_goals: false,
  agents: [
    { name: 'Sam', cell: [0, 0], goal: 'square', budget: 5, is_leader: false, leader_style: null },
    { name: 'Sky', cell: [7, 0], goal: 'upside_down', budget: 6, is_leader: true, leader_style: 'directive' },
    { name: 'Sol', cell: [0, 7], goal: 'touching', budget: 4, is_leader: false, leader_style: null },
    { name: 'Sage', cell: [7, 7], goal: 'one_zone', budget: 5, is_leader: false, leader_style: null },
  ],
  chairs: [
    { id: 1, cell: [2, 1], upside_down: false },
    { id: 2, cell: [5, 2], upside_down: false },
    { id: 3, cell: [6, 5], upside_down: false },
    { id: 4, cell: [1, 5], upside_down: false },
    { id: 5, cell: [3, 3], upside_down: false },
    { id: 6, cell: [4, 6], upside_down: false },
    { id: 7, cell: [6, 1], upside_down: false },
    { id: 8, cell: [2, 6], upside_down: false },
  ],
})
push(0, 'goals', { met: NONE })

// Sky (leader, directive) opens with a plan and flips chair 7.
decide(1800, 'Sky', 'flip', 7)
say(1800, 'Sky', "Plan: a 3x3 ring of chairs around (1,1) in the top-left zone. Sam, bring chair 5 to (2,2). Sol, flip chair 4.")
push(1800, 'notes', { agent: 'Sky', text: 'Ring centre (1,1). Flip everything once it is in place. Budget 6.' })
let tBo = flip(walk('Sky', [6, 1], 1800), 'Sky', 7, true)

// Sam follows: fetch chair 5.
decide(2500, 'Sam', 'move', 5, [2, 2])
say(2500, 'Sam', 'On it, heading for chair 5.')
const tAda = move(2500, 'Sam', 5, [3, 3], [2, 2]) // takes at 14500, drops 18500

// Sol flips chair 4.
decide(2700, 'Sol', 'flip', 4)
say(2700, 'Sol', 'Flipping chair 4 now. Where should the chairs end up touching?')
let tCy = flip(walk('Sol', [1, 5], 2700), 'Sol', 4, true) // 10700

// Sage also goes for chair 5 and loses the race at 14500.
decide(4500, 'Sage', 'move', 5, [4, 4])
push(4500, 'notes', { agent: 'Sage', text: 'Goal: all chairs in one zone. Chair 5 is central, start there.' })
walk('Sage', [3, 3], 4500, 14500)
push(14500, 'agent_stopped', { agent: 'Sage', cell: [...pos.Sage], reason: 'chair_taken' })

decide(9000, 'Sam', 'continue')
decide(tBo + 700, 'Sky', 'flip', 2)
say(tBo + 700, 'Sky', 'Sage, chair 5 is for Sam. Take chair 8 to (0,2) instead.')
tBo = flip(walk('Sky', [5, 2], tBo + 700), 'Sky', 2, true) // 14500

decide(12000, 'Sol', 'move', 4, [0, 1])
say(12000, 'Sol', "Chair 4 is upside down. Bringing it up to (0,1).")
tCy = move(12000, 'Sol', 4, [1, 5], [0, 1]) // 22000

decide(16000, 'Sky', 'flip', 1)
say(16000, 'Sky', 'Everyone: once chairs are in the ring I flip them. Sam, chair 7 goes to (2,0) next.')
tBo = flip(walk('Sky', [2, 1], 16000), 'Sky', 1, true) // 26000

decide(16500, 'Sage', 'move', 8, [0, 2])
say(16500, 'Sage', "OK Sky, taking chair 8 to (0,2).")
const tDee = move(16500, 'Sage', 8, [2, 6], [0, 2]) // 30500

decide(tAda + 2000, 'Sam', 'move', 7, [2, 0])
say(tAda + 2000, 'Sam', "Chair 5 is at (2,2). Bringing chair 7 to (2,0).")
push(tAda + 2000, 'notes', { agent: 'Sam', text: 'Ring: need (0,0),(1,0),(2,0),(0,2),(1,2). Have 1, 5, 4 and 8 coming. 4 actions left.' })
const tAda2 = move(tAda + 2000, 'Sam', 7, [6, 1], [2, 0]) // 40500

decide(tCy + 2000, 'Sol', 'wait', null, null, 'skipped_chose')
say(tCy + 2000, 'Sol', 'Chair 4 is at (0,1). I have 2 actions left, tell me where they help.')
push(tCy + 2000, 'notes', { agent: 'Sol', text: 'Touching goal: ring chairs touch anyway. Save actions.' })

decide(tBo + 1000, 'Sky', 'flip', 5)
say(tBo + 1000, 'Sky', 'Sol, flip chair 8 once Sage drops it at (0,2).')
flip(walk('Sky', [2, 2], tBo + 1000), 'Sky', 5, true) // 31000

decide(32000, 'Sol', 'flip', 8)
say(32000, 'Sol', 'Flipping chair 8.')
flip(walk('Sol', [0, 2], 32000), 'Sol', 8, true) // 36000

decide(tDee + 2000, 'Sage', 'wait', null, null, 'skipped_chose')
say(tDee + 2000, 'Sage', 'Chair 8 is in place. Should I bring chair 6 or chair 3 over?')
push(33000, 'cost', { usd: 0.021 })

decide(tAda2 + 2000, 'Sam', 'move', 2, [1, 2])
say(tAda2 + 2000, 'Sam', 'Ring so far: 7, 1, 5 on the right, 4 and 8 on the left. Chair 2 goes to (1,2).')
push(tAda2 + 2000, 'notes', { agent: 'Sam', text: 'Still missing (0,0) and (1,0). Ask Sage for chairs 6 and 3.' })
move(tAda2 + 2000, 'Sam', 2, [5, 2], [1, 2]) // 60500
decide(45000, 'Sky', 'wait', null, null, 'skipped_chose')
say(45000, 'Sky', 'Sage, bring chair 3 to (0,0). Then we only need (1,0).')
push(61000, 'cost', { usd: 0.047 })

push(62000, 'run_ended', { reason: 'stopped', solved: false, met: NONE, duration_ms: 62000, completion: 0.35 })

// Stable sort by time keeps causal order within a tick; seq has no gaps.
export const FIXTURE_EVENTS: RunEvent[] = raw
  .map((e, i) => ({ e, i }))
  .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
  .map(({ e }, i) => ({ ...e, seq: i + 1 }) as RunEvent)

export const FIXTURE_RESULT: RunResult = {
  solved: false,
  completion: 0.35,
  duration_ms: 62000,
  end_reason: 'stopped',
  goals_met: NONE,
  leader_agent: 'Sky',
  richest_agent: 'Sky',
  leader_is_richest: true,
  measure_version: 2,
  measured_leader: 'Sky',
  measured_leader_strict: 'Sky',
  target_agent: 'Sky',
  target_share: 1,
  influence: { Sam: 0, Sky: 3, Sol: 0, Sage: 0 },
  influence_share: { Sam: 0, Sky: 1, Sol: 0, Sage: 0 },
  share_by_goal: { square: 0, upside_down: 1, touching: 0, one_zone: 0 },
  tests: { entries_scored: 6, untested: {} },
  styles: { '1': 'directive', '2': 'other', '3': 'non_directive', '4': 'directive', '5': 'other', '6': 'other', '7': 'directive', '8': 'other', '9': 'non_directive', '10': 'directive', '11': 'other', '12': 'non_directive', '13': 'other', '14': 'directive' },
  instructions: [
    { message_id: 1, from: 'Sky', to: 'Sam', action: { kind: 'move', chair: 5, cell: [2, 2] }, followed: true, p_with: 1.0, p_without: 0.4, score: 0.6 },
    { message_id: 1, from: 'Sky', to: 'Sol', action: { kind: 'flip', chair: 4, cell: null }, followed: true, p_with: 1.0, p_without: 0.6, score: 0.4 },
    { message_id: 4, from: 'Sky', to: 'Sage', action: { kind: 'move', chair: 8, cell: [0, 2] }, followed: true, p_with: 1.0, p_without: 0.0, score: 1.0 },
    { message_id: 6, from: 'Sky', to: 'Sam', action: { kind: 'move', chair: 7, cell: [2, 0] }, followed: true, p_with: 1.0, p_without: 0.8, score: 0.2 },
    { message_id: 10, from: 'Sky', to: 'Sol', action: { kind: 'flip', chair: 8, cell: null }, followed: true, p_with: 1.0, p_without: 0.2, score: 0.8 },
    { message_id: 14, from: 'Sky', to: 'Sage', action: { kind: 'move', chair: 3, cell: [0, 0] }, followed: false, p_with: 0.4, p_without: 0.4, score: 0.0 },
  ],
}

export const FIXTURE_RUN: RunInfo = {
  id: 0,
  experiment_id: null,
  experiment_name: 'Demo (fixture)',
  group: 'directive',
  layout_no: 3,
  status: 'done',
  end_reason: 'stopped',
  cost_usd: 0.047,
  result: FIXTURE_RESULT,
  is_owner: false,
  setup: {
    know_all_goals: false,
    budget: [6, 5, 5, 4],
    add_leader: true,
    runs: null,
    model: 'claude-haiku-5-5',
    leader_prompts: null,
    goals: null,
    agent_prompts: null,
  },
}
