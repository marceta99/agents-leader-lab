import type { AgentState, BoardState, Cell, ChairState, GoalsMet, RunEvent } from './types'

const NO_GOALS: GoalsMet = { circle: false, upside_down: false, one_zone: false, touching: false }

interface Step {
  from: Cell
  to: Cell
  t: number
  dur: number
}

// Pure: rebuild the board at game time tMs from events with t <= tMs (events in seq order).
// ponytail: O(events) per call, recomputed every frame; add checkpoints if runs grow past ~10k events.
export function stateAt(events: RunEvent[], tMs: number): BoardState {
  const s: BoardState = {
    t: tMs,
    start: null,
    agents: [],
    chairs: [],
    goalsMet: { ...NO_GOALS },
    messages: [],
    costUsd: null,
    ended: null,
  }
  const agents = new Map<string, AgentState>()
  const chairs = new Map<number, ChairState>()
  const steps = new Map<string, Step>()
  const flips = new Map<number, { t: number; dur: number }>()

  for (const e of events) {
    if (e.t > tMs) break
    switch (e.type) {
      case 'run_started':
        s.start = e.data
        for (const a of e.data.agents) {
          agents.set(a.name, {
            name: a.name,
            cell: [...a.cell],
            pos: [...a.cell],
            goal: a.goal,
            budget: a.budget,
            isLeader: a.is_leader,
            leaderStyle: a.leader_style,
            holding: null,
            mode: 'idle',
            notes: '',
            lastDecision: null,
          })
        }
        for (const c of e.data.chairs) {
          chairs.set(c.id, {
            id: c.id,
            cell: [...c.cell],
            pos: [...c.cell],
            upsideDown: c.upside_down,
            heldBy: null,
            carried: false,
            flip: null,
          })
        }
        break
      case 'agent_step': {
        const a = agents.get(e.data.agent)
        if (a) a.cell = [...e.data.from]
        steps.set(e.data.agent, { from: e.data.from, to: e.data.to, t: e.t, dur: e.data.dur_ms })
        break
      }
      case 'agent_stopped': {
        const a = agents.get(e.data.agent)
        if (a) a.cell = [...e.data.cell]
        steps.delete(e.data.agent)
        break
      }
      case 'chair_taken': {
        const a = agents.get(e.data.agent)
        const c = chairs.get(e.data.chair)
        if (a) {
          a.holding = e.data.chair
          a.budget = e.data.budget_left
        }
        if (c) {
          c.heldBy = e.data.agent
          c.carried = e.data.for === 'move'
        }
        break
      }
      case 'chair_dropped': {
        const a = agents.get(e.data.agent)
        const c = chairs.get(e.data.chair)
        if (a) a.holding = null
        if (c) {
          c.cell = [...e.data.cell]
          c.heldBy = null
          c.carried = false
        }
        break
      }
      case 'flip_started':
        flips.set(e.data.chair, { t: e.t, dur: e.data.dur_ms })
        break
      case 'flip_done': {
        const a = agents.get(e.data.agent)
        const c = chairs.get(e.data.chair)
        if (a) a.holding = null
        if (c) {
          c.upsideDown = e.data.upside_down
          c.heldBy = null
          c.carried = false
        }
        flips.delete(e.data.chair)
        break
      }
      case 'message':
        s.messages.push({ id: e.data.id, agent: e.data.agent, text: e.data.text, t: e.t })
        break
      case 'notes': {
        const a = agents.get(e.data.agent)
        if (a) a.notes = e.data.text
        break
      }
      case 'decision': {
        const a = agents.get(e.data.agent)
        if (a) a.lastDecision = e.data
        break
      }
      case 'goals':
        s.goalsMet = { ...NO_GOALS, ...e.data.met }
        break
      case 'cost':
        s.costUsd = e.data.usd
        break
      case 'run_ended':
        s.ended = e.data
        s.goalsMet = { ...NO_GOALS, ...e.data.met }
        break
      // unknown event types from a newer backend are ignored
    }
  }

  // Interpolate walks and derive each agent's mode.
  for (const a of agents.values()) {
    const st = steps.get(a.name)
    let moving = false
    if (st) {
      const k = st.dur > 0 ? (tMs - st.t) / st.dur : 1
      if (k >= 1 || s.ended) {
        a.cell = [...st.to]
        a.pos = [...st.to]
      } else {
        moving = true
        a.pos = [st.from[0] + (st.to[0] - st.from[0]) * k, st.from[1] + (st.to[1] - st.from[1]) * k]
      }
    } else {
      a.pos = [...a.cell]
    }
    const held = a.holding != null ? chairs.get(a.holding) : undefined
    if (held && flips.has(held.id)) a.mode = 'flipping'
    else if (moving) a.mode = held ? 'carrying' : 'walking'
    else a.mode = 'idle'
    if (held?.carried) {
      held.cell = [...a.cell]
      held.pos = [...a.pos]
    }
  }
  for (const c of chairs.values()) {
    const f = flips.get(c.id)
    if (f) c.flip = Math.min(1, Math.max(0, f.dur > 0 ? (tMs - f.t) / f.dur : 1))
    if (!c.carried) c.pos = [...c.cell]
  }

  s.agents = [...agents.values()]
  s.chairs = [...chairs.values()]
  return s
}

export const fmtTime = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
