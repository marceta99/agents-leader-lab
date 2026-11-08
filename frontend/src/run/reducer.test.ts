import { describe, expect, it } from 'vitest'
import { FIXTURE_EVENTS as EV } from './fixture'
import { stateAt } from './reducer'
import type { RunEvent } from './types'

const find = <K extends RunEvent['type']>(type: K, pred: (e: Extract<RunEvent, { type: K }>) => boolean = () => true) =>
  EV.find((e) => e.type === type && pred(e as Extract<RunEvent, { type: K }>)) as Extract<RunEvent, { type: K }>
const agent = (t: number, name: string) => stateAt(EV, t).agents.find((a) => a.name === name)!
const chair = (t: number, id: number) => stateAt(EV, t).chairs.find((c) => c.id === id)!

describe('fixture', () => {
  it('follows the contract shape', () => {
    expect(EV[0].type).toBe('run_started')
    expect(EV.at(-1)!.type).toBe('run_ended')
    EV.forEach((e, i) => expect(e.seq).toBe(i + 1))
    for (let i = 1; i < EV.length; i++) expect(EV[i].t).toBeGreaterThanOrEqual(EV[i - 1].t)
    for (const e of EV) {
      if (e.type !== 'agent_step') continue
      const d = Math.abs(e.data.from[0] - e.data.to[0]) + Math.abs(e.data.from[1] - e.data.to[1])
      expect(d).toBe(1)
    }
    const ids = EV.flatMap((e) => (e.type === 'message' ? [e.data.id] : []))
    expect(ids).toEqual(ids.map((_, i) => i + 1))
    expect(EV.length).toBeGreaterThanOrEqual(60)
    expect(EV.length).toBeLessThanOrEqual(130)
  })
})

describe('stateAt', () => {
  it('t=0 matches run_started', () => {
    const start = find('run_started').data
    const s = stateAt(EV, 0)
    expect(s.agents.map((a) => [a.name, a.cell, a.budget, a.goal, a.isLeader])).toEqual(
      start.agents.map((a) => [a.name, a.cell, a.budget, a.goal, a.is_leader]),
    )
    expect(s.chairs.map((c) => [c.id, c.cell, c.upsideDown, c.heldBy])).toEqual(
      start.chairs.map((c) => [c.id, c.cell, c.upside_down, null]),
    )
    expect(s.agents.every((a) => a.mode === 'idle' && a.holding === null)).toBe(true)
    expect(s.messages).toEqual([])
    expect(s.ended).toBeNull()
  })

  it('interpolates an agent mid-step', () => {
    const st = find('agent_step')
    const a = agent(st.t + st.data.dur_ms / 2, st.data.agent)
    expect(a.pos[0]).toBeCloseTo((st.data.from[0] + st.data.to[0]) / 2)
    expect(a.pos[1]).toBeCloseTo((st.data.from[1] + st.data.to[1]) / 2)
    expect(a.mode).toBe('walking')
  })

  it('a carried chair follows the agent', () => {
    const take = find('chair_taken', (e) => e.data.for === 'move')
    const step = find('agent_step', (e) => e.data.agent === take.data.agent && e.t >= take.t)
    const t = step.t + step.data.dur_ms * 0.3
    const s = stateAt(EV, t)
    const a = s.agents.find((x) => x.name === take.data.agent)!
    const c = s.chairs.find((x) => x.id === take.data.chair)!
    expect(a.mode).toBe('carrying')
    expect(a.holding).toBe(c.id)
    expect(c.carried).toBe(true)
    expect(c.heldBy).toBe(a.name)
    expect(c.pos).toEqual(a.pos)
  })

  it('a dropped chair sits on the drop cell', () => {
    const drop = find('chair_dropped')
    const c = chair(drop.t, drop.data.chair)
    expect(c.cell).toEqual(drop.data.cell)
    expect(c.pos).toEqual(drop.data.cell)
    expect(c.heldBy).toBeNull()
    expect(agent(drop.t, drop.data.agent).holding).toBeNull()
  })

  it('flip progresses and flip_done toggles upside_down', () => {
    const fs = find('flip_started')
    const fd = find('flip_done', (e) => e.data.chair === fs.data.chair)
    expect(chair(fs.t - 1, fs.data.chair).upsideDown).toBe(false)
    const mid = chair(fs.t + fs.data.dur_ms / 2, fs.data.chair)
    expect(mid.flip).toBeCloseTo(0.5)
    expect(agent(fs.t + 1, fs.data.agent).mode).toBe('flipping')
    const done = chair(fd.t, fd.data.chair)
    expect(done.upsideDown).toBe(true)
    expect(done.flip).toBeNull()
    expect(done.heldBy).toBeNull()
  })

  it('agent_stopped snaps the agent to its cell', () => {
    const stop = find('agent_stopped')
    const a = agent(stop.t + 500, stop.data.agent)
    expect(a.pos).toEqual(stop.data.cell)
    expect(a.mode).toBe('idle')
  })

  it('budgets follow chair_taken', () => {
    const take = find('chair_taken')
    expect(agent(take.t, take.data.agent).budget).toBe(take.data.budget_left)
  })

  it('seeking backwards gives the earlier state', () => {
    const early = 9000
    const before = stateAt(EV, early)
    stateAt(EV, 60000)
    expect(stateAt(EV, early)).toEqual(before)
    const end = stateAt(EV, 1e9)
    expect(end.ended?.reason).toBe('stopped')
    expect(before.ended).toBeNull()
  })

  it('chat at t only includes messages with t <= t', () => {
    for (const t of [0, 2499, 2500, 16000, 30000, 1e9]) {
      const msgs = stateAt(EV, t).messages
      const expected = EV.filter((e) => e.type === 'message' && e.t <= t).length
      expect(msgs.length).toBe(expected)
      expect(msgs.every((m) => m.t <= t)).toBe(true)
    }
  })

  it('notes keep the latest text per agent', () => {
    const notes = EV.filter((e) => e.type === 'notes' && e.data.agent === 'Sam') as Extract<RunEvent, { type: 'notes' }>[]
    expect(agent(1e9, 'Sam').notes).toBe(notes.at(-1)!.data.text)
  })
})
