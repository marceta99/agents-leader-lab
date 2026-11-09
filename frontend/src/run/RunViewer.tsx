import { useMemo, useState } from 'react'
import { groupLabel, statusLabel } from '../format'
import { BackLink } from '../ui/Labels'
import AgentPanel from './AgentPanel'
import ChatPanel from './ChatPanel'
import { fmtTime, stateAt } from './reducer'
import Room3D from './Room3D'
import './run.css'
import SetupOverview from './SetupOverview'
import ResultsView, { runResults } from '../pages/ResultsView'
import Timeline from './Timeline'
import { GOAL_IDS, GOAL_SHORT, isGoalId } from './types'
import { usePlayback } from './usePlayback'
import { isLiveStatus, useRunEvents } from './useRunEvents'

type Tab = 'chat' | 'agents'

/** `demo`: shows the experiment's setup on top and keeps the measurements hidden until the replay reaches the end. */
export default function RunViewer(props: { runId?: number; shareToken?: string; fixture?: boolean; demo?: boolean }) {
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
  // A demo reveals the measurements only once the replay has reached the end, as the owner saw them.
  const result = !props.demo || state.ended ? run.result : null
  const leader = result?.measured_leader ?? null
  const title = props.fixture ? 'Demo run' : (run.experiment_name ?? `Run ${run.id}`)
  const agentGoals = state.agents.flatMap((a) => (Array.isArray(a.goal) ? a.goal : [a.goal]) as string[])
  const builtinGoals = agentGoals.length ? GOAL_IDS.filter((g) => agentGoals.includes(g)) : GOAL_IDS
  const customGoals = agentGoals.filter((g) => !isGoalId(g))
  const back = props.demo || props.shareToken ? null : run.is_owner && run.experiment_id ? `/experiments/${run.experiment_id}` : '/'
  return (
    <div className="rv">
      {back && <BackLink to={back}>{back === '/' ? 'Home' : 'Back to the experiment'}</BackLink>}
      {props.demo && run.setup && <SetupOverview setup={run.setup} run={run} agents={state.agents} />}
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
          {state.ended && !state.ended.solved && state.ended.completion != null && (
            <div>
              <dt>Completion</dt>
              <dd className="tnum">{Math.round(state.ended.completion * 100)}%</dd>
            </div>
          )}
          {result && (
            <div>
              <dt>Measured leader</dt>
              <dd>
                {leader ?? 'None'}
                {result.measure_version === 2 && (
                  <span className="rv-dim">
                    {' '}
                    (2+ followers: {result.measured_leader_strict ?? 'none'})
                  </span>
                )}
              </dd>
            </div>
          )}
          {result?.target_agent && (
            <div>
              <dt>{result.target_agent}'s influence share</dt>
              <dd className="tnum">{result.target_share == null ? 'nobody influenced' : `${Math.round(result.target_share * 100)}%`}</dd>
            </div>
          )}
        </dl>
        <ul className="rv-goals" aria-label="Goals">
          {builtinGoals.map((g) => (
            <li key={g} className={state.goalsMet[g] ? 'met' : undefined}>
              <span aria-hidden="true">{state.goalsMet[g] ? '✓' : '○'}</span> {g === 'one_zone' && start?.target_zone != null ? `Zone ${start.target_zone}` : GOAL_SHORT[g]}
              <span className="rv-sr">{state.goalsMet[g] ? ' (met)' : ' (not met)'}</span>
            </li>
          ))}
          {customGoals.map((g) => (
            <li key={g} className="custom" title={`Custom goal, not checked by the game: ${g}`}>
              <span aria-hidden="true">◇</span> {g.length > 32 ? `${g.slice(0, 30)}…` : g}
              <span className="rv-sr"> (custom goal, not checked by the game)</span>
            </li>
          ))}
        </ul>
      </header>

      {props.demo && run.result && (
        <p className={result ? 'rv-reveal on' : 'rv-reveal'} role="status">
          {result
            ? 'The game is over, so the measurements are shown: the measured leader above, and in the chat each message’s style and what the replays found.'
            : 'The measurements appear when the replay reaches the end of the game. Drag the timeline to the end to see them now.'}
        </p>
      )}

      <div className="rv-layout">
        <div className="rv-stage">
          <div className="rv-canvas" role="img" aria-label="3D view of the room with the agents and chairs. Drag to look around (two fingers on a phone).">
            {start ? (
              <>
                <Room3D state={state} leader={leader} />
                <span className="rv-rotate" title="Drag to rotate the room (two fingers on a phone)" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22">
                    <path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </>
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
            <ChatPanel messages={state.messages} result={result} follow={live || pb.playing} />
          </div>
          <div className={tab === 'agents' ? 'rv-pane on' : 'rv-pane'}>
            <AgentPanel agents={state.agents} goalsMet={state.goalsMet} leader={leader} zone={start?.target_zone} />
          </div>
        </div>
      </div>

      {props.demo && result && (
        <section className="rv-results" aria-labelledby="rv-results-title">
          <h2 id="rv-results-title">Results</h2>
          <p className="muted">
            What the experiment page shows once runs are measured, here for this one run. A real experiment averages
            these numbers over all its runs.
          </p>
          <ResultsView
            results={runResults(result, run.group)}
            budget={run.setup?.budget ?? []}
            addLeader={!!run.setup?.add_leader}
            leaderPrompts={run.setup?.leader_prompts}
          />
        </section>
      )}
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
