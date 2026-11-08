import type { CSSProperties, PointerEvent } from 'react'
import { FIXTURE_EVENTS, FIXTURE_RESULT } from '../run/fixture'
import { fmtTime } from '../run/reducer'
import type { Instruction } from '../run/types'
import { AGENT_COLORS } from '../run/types'

// Three real instructions from the demo run: a strong one, a partial one and one that was ignored.
const PICK: [number, number, number][] = [
  // [instruction index, rotation deg, stacking order]
  [2, -4, 1],
  [0, 3, 2],
  [5, -1.5, 3],
]

const messageOf = (id: number) => {
  for (const e of FIXTURE_EVENTS) if (e.type === 'message' && e.data.id === id) return e
  return null
}

const action = (i: Instruction) =>
  `${i.action.kind} chair ${i.action.chair}${i.action.cell ? ` to (${i.action.cell[0]},${i.action.cell[1]})` : ''}`

// Tilt toward the pointer (only where hover exists and motion is allowed; see landing.css).
function tilt(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse') return
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -8}deg`)
  e.currentTarget.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`)
}
function untilt(e: PointerEvent<HTMLElement>) {
  e.currentTarget.style.removeProperty('--rx')
  e.currentTarget.style.removeProperty('--ry')
}

export default function IndexCards() {
  const instructions = FIXTURE_RESULT.instructions ?? []
  return (
    <div className="l-cards">
      {PICK.map(([idx, rot, z]) => {
        const i = instructions[idx]
        const m = messageOf(i.message_id)
        if (!m || m.type !== 'message') return null
        return (
          <article
            key={idx}
            className={i.followed ? 'l-card' : 'l-card ignored'}
            style={{ '--rot': `${rot}deg`, '--from': AGENT_COLORS[i.from], zIndex: z } as CSSProperties}
            onPointerMove={tilt}
            onPointerLeave={untilt}
          >
            <header className="l-card-head">
              <span>
                <b>{i.from}</b> to <b>{i.to}</b>: {action(i)}
              </span>
              <span className="tnum">{fmtTime(m.t)}</span>
            </header>
            <blockquote className="l-card-quote">{m.data.text}</blockquote>
            <dl className="l-card-facts">
              <div>
                <dt>{i.to}</dt>
                <dd>{i.followed ? '✓ followed' : '✕ did not follow'}</dd>
              </div>
              <div>
                <dt>Would have done it anyway</dt>
                <dd className="tnum">{i.p_without != null ? `${Math.round(i.p_without * 100)}%` : 'not replayed'}</dd>
              </div>
              <div className="l-card-score">
                <dt>Influence</dt>
                <dd className="tnum">{(i.score ?? 0).toFixed(2)}</dd>
              </div>
            </dl>
          </article>
        )
      })}
    </div>
  )
}
