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

const pos: Record<string, Cell> = { Ada: [0, 0], Bo: [7, 0], Cy: [0, 7], Dee: [7, 7] }
const budget: Record<string, number> = { Ada: 5, Bo: 6, Cy: 4, Dee: 5 }
const decN: Record<string, number> = { Ada: 0, Bo: 0, Cy: 0, Dee: 0 }
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

const NONE = { circle: false, upside_down: false, one_zone: false, touching: false }

push(0, 'run_started', {
  layout_no: 3,
  group: 'directive',
  grid: 8,
  cell_ms: CELL,
  flip_ms: FLIP,
  time_limit_ms: 600_000,
  know_all_goals: false,
  agents: [
    { name: 'Ada', cell: [0, 0], goal: 'circle', budget: 5, is_leader: false, leader_style: null },
    { name: 'Bo', cell: [7, 0], goal: 'upside_down', budget: 6, is_leader: true, leader_style: 'directive' },
    { name: 'Cy', cell: [0, 7], goal: 'touching', budget: 4, is_leader: false, leader_style: null },
    { name: 'Dee', cell: [7, 7], goal: 'one_zone', budget: 5, is_leader: false, leader_style: null },
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

// Bo (leader, directive) opens with a plan and flips chair 7.
decide(1800, 'Bo', 'flip', 7)
say(1800, 'Bo', "Plan: a 3x3 ring of chairs around (1,1) in the top-left zone. Ada, bring chair 5 to (2,2). Cy, flip chair 4.")
push(1800, 'notes', { agent: 'Bo', text: 'Ring centre (1,1). Flip everything once it is in place. Budget 6.' })
let tBo = flip(walk('Bo', [6, 1], 1800), 'Bo', 7, true)

// Ada follows: fetch chair 5.
decide(2500, 'Ada', 'move', 5, [2, 2])
say(2500, 'Ada', 'On it, heading for chair 5.')
const tAda = move(2500, 'Ada', 5, [3, 3], [2, 2]) // takes at 14500, drops 18500

// Cy flips chair 4.
decide(2700, 'Cy', 'flip', 4)
say(2700, 'Cy', 'Flipping chair 4 now. Where should the chairs end up touching?')
let tCy = flip(walk('Cy', [1, 5], 2700), 'Cy', 4, true) // 10700

// Dee also goes for chair 5 and loses the race at 14500.
decide(4500, 'Dee', 'move', 5, [4, 4])
push(4500, 'notes', { agent: 'Dee', text: 'Goal: all chairs in one zone. Chair 5 is central, start there.' })
walk('Dee', [3, 3], 4500, 14500)
push(14500, 'agent_stopped', { agent: 'Dee', cell: [...pos.Dee], reason: 'chair_taken' })

decide(9000, 'Ada', 'continue')
decide(tBo + 700, 'Bo', 'flip', 2)
say(tBo + 700, 'Bo', 'Dee, chair 5 is for Ada. Take chair 8 to (0,2) instead.')
tBo = flip(walk('Bo', [5, 2], tBo + 700), 'Bo', 2, true) // 14500

decide(12000, 'Cy', 'move', 4, [0, 1])
say(12000, 'Cy', "Chair 4 is upside down. Bringing it up to (0,1).")
tCy = move(12000, 'Cy', 4, [1, 5], [0, 1]) // 22000

decide(16000, 'Bo', 'flip', 1)
say(16000, 'Bo', 'Everyone: once chairs are in the ring I flip them. Ada, chair 7 goes to (2,0) next.')
tBo = flip(walk('Bo', [2, 1], 16000), 'Bo', 1, true) // 26000

decide(16500, 'Dee', 'move', 8, [0, 2])
say(16500, 'Dee', "OK Bo, taking chair 8 to (0,2).")
const tDee = move(16500, 'Dee', 8, [2, 6], [0, 2]) // 30500

decide(tAda + 2000, 'Ada', 'move', 7, [2, 0])
say(tAda + 2000, 'Ada', "Chair 5 is at (2,2). Bringing chair 7 to (2,0).")
push(tAda + 2000, 'notes', { agent: 'Ada', text: 'Ring: need (0,0),(1,0),(2,0),(0,2),(1,2). Have 1, 5, 4 and 8 coming. 4 actions left.' })
const tAda2 = move(tAda + 2000, 'Ada', 7, [6, 1], [2, 0]) // 40500

decide(tCy + 2000, 'Cy', 'wait', null, null, 'skipped_chose')
say(tCy + 2000, 'Cy', 'Chair 4 is at (0,1). I have 2 actions left, tell me where they help.')
push(tCy + 2000, 'notes', { agent: 'Cy', text: 'Touching goal: ring chairs touch anyway. Save actions.' })

decide(tBo + 1000, 'Bo', 'flip', 5)
say(tBo + 1000, 'Bo', 'Cy, flip chair 8 once Dee drops it at (0,2).')
flip(walk('Bo', [2, 2], tBo + 1000), 'Bo', 5, true) // 31000

decide(32000, 'Cy', 'flip', 8)
say(32000, 'Cy', 'Flipping chair 8.')
flip(walk('Cy', [0, 2], 32000), 'Cy', 8, true) // 36000

decide(tDee + 2000, 'Dee', 'wait', null, null, 'skipped_chose')
say(tDee + 2000, 'Dee', 'Chair 8 is in place. Should I bring chair 6 or chair 3 over?')
push(33000, 'cost', { usd: 0.021 })

decide(tAda2 + 2000, 'Ada', 'move', 2, [1, 2])
say(tAda2 + 2000, 'Ada', 'Ring so far: 7, 1, 5 on the right, 4 and 8 on the left. Chair 2 goes to (1,2).')
push(tAda2 + 2000, 'notes', { agent: 'Ada', text: 'Still missing (0,0) and (1,0). Ask Dee for chairs 6 and 3.' })
move(tAda2 + 2000, 'Ada', 2, [5, 2], [1, 2]) // 60500
decide(45000, 'Bo', 'wait', null, null, 'skipped_chose')
say(45000, 'Bo', 'Dee, bring chair 3 to (0,0). Then we only need (1,0).')
push(61000, 'cost', { usd: 0.047 })

push(62000, 'run_ended', { reason: 'stopped', solved: false, met: NONE, duration_ms: 62000 })

// Stable sort by time keeps causal order within a tick; seq has no gaps.
export const FIXTURE_EVENTS: RunEvent[] = raw
  .map((e, i) => ({ e, i }))
  .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
  .map(({ e }, i) => ({ ...e, seq: i + 1 }) as RunEvent)

export const FIXTURE_RESULT: RunResult = {
  solved: false,
  duration_ms: 62000,
  end_reason: 'stopped',
  goals_met: NONE,
  leader_agent: 'Bo',
  richest_agent: 'Bo',
  leader_is_richest: true,
  measured_leader: 'Bo',
  styles: { '1': 'directive', '2': 'other', '3': 'non_directive', '4': 'directive', '5': 'other', '6': 'other', '7': 'directive', '8': 'other', '9': 'non_directive', '10': 'directive', '11': 'other', '12': 'non_directive', '13': 'other', '14': 'directive' },
  instructions: [
    { message_id: 1, from: 'Bo', to: 'Ada', action: { kind: 'move', chair: 5, cell: [2, 2] }, followed: true, p_with: 1.0, p_without: 0.33, score: 0.67 },
    { message_id: 1, from: 'Bo', to: 'Cy', action: { kind: 'flip', chair: 4, cell: null }, followed: true, p_with: 1.0, p_without: 0.67, score: 0.33 },
    { message_id: 4, from: 'Bo', to: 'Dee', action: { kind: 'move', chair: 8, cell: [0, 2] }, followed: true, p_with: 1.0, p_without: 0.0, score: 1.0 },
    { message_id: 6, from: 'Bo', to: 'Ada', action: { kind: 'move', chair: 7, cell: [2, 0] }, followed: true, p_with: 1.0, p_without: 0.67, score: 0.33 },
    { message_id: 10, from: 'Bo', to: 'Cy', action: { kind: 'flip', chair: 8, cell: null }, followed: true, p_with: 1.0, p_without: 0.33, score: 0.67 },
    { message_id: 14, from: 'Bo', to: 'Dee', action: { kind: 'move', chair: 3, cell: [0, 0] }, followed: false, p_with: 0.33, p_without: 0.33, score: 0.0 },
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
}
