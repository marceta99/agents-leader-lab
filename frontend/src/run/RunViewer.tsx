import { useMemo } from 'react'
import AgentPanel from './AgentPanel'
import ChatPanel from './ChatPanel'
import { fmtTime, stateAt } from './reducer'
import Room3D from './Room3D'
import './run.css'
import Timeline from './Timeline'
import { GOAL_IDS, GOAL_SHORT } from './types'
import { usePlayback } from './usePlayback'
import { isLiveStatus, useRunEvents } from './useRunEvents'

export default function RunViewer(props: { runId?: number; shareToken?: string; fixture?: boolean }) {
  const { run, events, error } = useRunEvents(props)
  const ended = events.at(-1)?.type === 'run_ended'
  const live = isLiveStatus(run?.status) && !ended
  const pb = usePlayback(events, live)
  const state = useMemo(() => stateAt(events, pb.t), [events, pb.t])

  if (error) return <div className="panel error">Could not load run: {error}</div>
  if (!run) return <div className="muted">Loading run…</div>

  const start = state.start
  const status = live ? run.status : ended ? (isLiveStatus(run.status) ? 'done' : run.status) : run.status
  return (
    <div className="run-viewer">
      <div className="panel run-header">
        {live && <span className="run-live">LIVE</span>}
        <span>
          <span className="muted">Status</span> <b>{status}</b>
        </span>
        <span>
          <span className="muted">Group</span> <b>{run.group}</b>
        </span>
        <span>
          <span className="muted">Layout</span> <b>#{run.layout_no}</b>
        </span>
        <span>
          <span className="muted">Time</span> <b>{fmtTime(state.t)}</b>
          {start && <span className="muted"> / {fmtTime(start.time_limit_ms)}</span>}
        </span>
        <span className="row run-goals">
          {GOAL_IDS.map((g) => (
            <span key={g} className={state.goalsMet[g] ? 'run-chip met' : 'run-chip'}>
              {state.goalsMet[g] ? '✓' : '○'} {GOAL_SHORT[g]}
            </span>
          ))}
        </span>
        {state.ended && (
          <span>
            <span className="muted">Ended</span> <b>{state.ended.reason.replaceAll('_', ' ')}</b>
            {state.ended.solved && ' 🎉'}
          </span>
        )}
      </div>

      <div className="run-layout">
        <div className="run-left">
          <div className="run-canvas">
            {start ? <Room3D state={state} /> : <div className="muted run-wait">Waiting for the run to start…</div>}
          </div>
          {!live && (
            <Timeline
              t={pb.t}
              duration={pb.duration}
              playing={pb.playing}
              speed={pb.speed}
              onToggle={pb.toggle}
              onSeek={pb.seek}
              onSpeed={pb.setSpeed}
            />
          )}
        </div>
        <div className="run-right">
          <ChatPanel messages={state.messages} result={run.result} follow={live || pb.playing} />
          <AgentPanel agents={state.agents} goalsMet={state.goalsMet} />
        </div>
      </div>
    </div>
  )
}
