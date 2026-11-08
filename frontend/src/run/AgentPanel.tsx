import { useState } from 'react'
import type { AgentState, GoalId, GoalsMet } from './types'
import { AGENT_COLORS, GOAL_TEXT } from './types'

export default function AgentPanel({ agents, goalsMet }: { agents: AgentState[]; goalsMet: GoalsMet }) {
  const [showNotes, setShowNotes] = useState(false)
  return (
    <section className="panel run-agents">
      <div className="row run-agents-head">
        <h3>Agents</h3>
        <label className="run-toggle">
          <input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} />
          Show private notes
        </label>
      </div>
      {agents.map((a) => {
        const goals: GoalId[] = Array.isArray(a.goal) ? a.goal : [a.goal]
        return (
          <div key={a.name} className="run-agent" style={{ borderLeftColor: AGENT_COLORS[a.name] }}>
            <div className="row">
              <b style={{ color: AGENT_COLORS[a.name] }}>{a.name}</b>
              {a.isLeader && (
                <span className="run-tag leader" title={`Told to lead (${a.leaderStyle ?? 'free'})`}>
                  ★ leader
                </span>
              )}
              <span className="muted run-agent-state">{a.mode}</span>
            </div>
            {goals.map((g) => (
              <div key={g} className="run-agent-goal">
                {goalsMet[g] ? '✓ ' : ''}
                {GOAL_TEXT[g] ?? g}
              </div>
            ))}
            <div className="muted run-agent-stats">
              Actions left: <b>{a.budget}</b> · Holding: <b>{a.holding != null ? `chair ${a.holding}` : '—'}</b>
            </div>
            {showNotes && <div className="run-notes">{a.notes || <span className="muted">(no notes)</span>}</div>}
          </div>
        )
      })}
    </section>
  )
}
