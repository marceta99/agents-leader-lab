import { useMemo, useState } from 'react'
import { groupLabel, statusLabel } from '../format'
import AgentPanel from './AgentPanel'
import ChatPanel from './ChatPanel'
import { fmtTime, stateAt } from './reducer'
import Room3D from './Room3D'
import './run.css'
import Timeline from './Timeline'
import { GOAL_IDS, GOAL_SHORT } from './types'
import { usePlayback } from './usePlayback'
import { isLiveStatus, useRunEvents } from './useRunEvents'

type Tab = 'chat' | 'agents'

export default function RunViewer(props: { runId?: number; shareToken?: string; fixture?: boolean }) {
  const { run, events, error } = useRunEvents(props)
  const ended = events.at(-1)?.type === 'run_ended'
  const live = isLiveStatus(run?.status) && !ended
  const pb = usePlayback(events, live)
  const state = useMemo(() => stateAt(events, pb.t), [events, pb.t])
  const [tab, setTab] = useState<Tab>('chat')

  if (error) return <div className="panel error">Could not load this run: {error}. Check the link, or open it from its experiment page.</div>
  if (!run) return <RunSkeleton />

  const start = state.start
  const status = live ? run.status : ended && isLiveStatus(run.status) ? 'finished' : run.status
  const leader = run.result?.measured_leader ?? null
  const title = props.fixture ? 'Demo run' : (run.experiment_name ?? `Run ${run.id}`)
  return (
    <div className="rv">
      <header className="rv-head">
        <div className="rv-title">
          <h1>{title}</h1>
          <p className="rv-sub">
            Layout {run.layout_no}, {groupLabel(run.group).toLowerCase()}
            {props.fixture && '. A scripted run that shows how the viewer works.'}
          </p>
        </div>
        <dl className="rv-facts">
          {live && (
            <div className="rv-live" role="status">
              <i aria-hidden="true" />
              Live
            </div>
          )}
          <div>
            <dt>Status</dt>
            <dd>{statusLabel(status === 'done' ? 'finished' : status)}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd className="tnum">
              {fmtTime(state.t)}
              {start && <span className="rv-dim"> of {fmtTime(start.time_limit_ms)}</span>}
            </dd>
          </div>
          {state.ended && (
            <div>
              <dt>Ended</dt>
              <dd>{state.ended.solved ? 'Solved' : state.ended.reason.replaceAll('_', ' ')}</dd>
            </div>
          )}
          {run.result && (
            <div>
              <dt>Measured leader</dt>
              <dd>{leader ?? 'None'}</dd>
            </div>
          )}
        </dl>
        <ul className="rv-goals" aria-label="Goals">
          {GOAL_IDS.map((g) => (
            <li key={g} className={state.goalsMet[g] ? 'met' : undefined}>
              <span aria-hidden="true">{state.goalsMet[g] ? '✓' : '○'}</span> {GOAL_SHORT[g]}
              <span className="rv-sr">{state.goalsMet[g] ? ' (met)' : ' (not met)'}</span>
            </li>
          ))}
        </ul>
      </header>

      <div className="rv-layout">
        <div className="rv-stage">
          <div className="rv-canvas" role="img" aria-label="3D view of the room with the agents and chairs. Drag to look around (two fingers on a phone).">
            {start ? (
              <Room3D state={state} leader={leader} />
            ) : (
              <div className="rv-wait">Waiting for the run to start. The room appears as soon as the first event arrives.</div>
            )}
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
        <div className="rv-side">
          <div className="rv-seg" role="tablist" aria-label="Side panel">
            {(['chat', 'agents'] as Tab[]).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : undefined} onClick={() => setTab(k)}>
                {k === 'chat' ? `Chat (${state.messages.length})` : 'Agents'}
              </button>
            ))}
          </div>
          <div className={tab === 'chat' ? 'rv-pane on' : 'rv-pane'}>
            <ChatPanel messages={state.messages} result={run.result} follow={live || pb.playing} />
          </div>
          <div className={tab === 'agents' ? 'rv-pane on' : 'rv-pane'}>
            <AgentPanel agents={state.agents} goalsMet={state.goalsMet} leader={leader} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function RunSkeleton() {
  return (
    <div className="rv" aria-busy="true">
      <header className="rv-head">
        <div className="rv-title">
          <h1 className="rv-ghost">Loading run</h1>
        </div>
      </header>
      <div className="rv-layout">
        <div className="rv-stage">
          <div className="rv-canvas rv-canvas-empty">
            <div className="rv-wait">Loading the room…</div>
          </div>
        </div>
      </div>
    </div>
  )
}
