import { useState } from 'react'
import type { AgentState, GoalId, GoalsMet } from './types'
import { AGENT_COLORS, GOAL_TEXT } from './types'

const STYLE_TEXT = { free: 'its own way', directive: 'giving instructions', nondirective: 'asking and proposing' } as const

function doing(a: AgentState) {
  if (a.mode === 'carrying') return `Carrying chair ${a.holding}`
  if (a.mode === 'flipping') return `Flipping chair ${a.holding}`
  if (a.mode === 'walking') return 'Walking'
  return 'Standing'
}

export default function AgentPanel(props: { agents: AgentState[]; goalsMet: GoalsMet; leader?: string | null }) {
  const { agents, goalsMet, leader } = props
  const [showNotes, setShowNotes] = useState(false)
  return (
    <section className="rv-panel rv-agents" aria-label="Agents">
      <div className="rv-agents-head">
        <h2 className="rv-h">Agents</h2>
        <label className="rv-toggle">
          <input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} />
          Show private notes
        </label>
      </div>
      <ul className="rv-agent-list">
        {agents.map((a) => {
          const goals: GoalId[] = Array.isArray(a.goal) ? a.goal : [a.goal]
          return (
            <li key={a.name} className="rv-agent" style={{ ['--agent' as string]: AGENT_COLORS[a.name] }}>
              <div className="rv-agent-top">
                <span className="rv-agent-name">{a.name}</span>
                {a.name === leader && <span className="rv-tag strong">★ Measured leader</span>}
                {a.isLeader && (
                  <span className="rv-tag" title={`Told to lead by ${STYLE_TEXT[a.leaderStyle ?? 'free'] ?? a.leaderStyle}`}>
                    Told to lead
                  </span>
                )}
                <span className="rv-agent-doing">{doing(a)}</span>
              </div>
              {goals.map((g) => (
                <div key={g} className={goalsMet[g] ? 'rv-goal met' : 'rv-goal'}>
                  <span aria-hidden="true">{goalsMet[g] ? '✓' : '○'}</span> {GOAL_TEXT[g] ?? g}
                  {goalsMet[g] && <span className="rv-sr"> (met)</span>}
                </div>
              ))}
              <div className="rv-budget">
                <span>
                  Actions left <b className="tnum">{a.budget}</b>
                </span>
                <span className="rv-pips" aria-hidden="true">
                  {Array.from({ length: Math.min(a.budget, 12) }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
              </div>
              {showNotes && <div className="rv-notes">{a.notes || <span className="rv-dim">No notes yet.</span>}</div>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
