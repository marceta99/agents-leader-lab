import { duration, GROUP_LABELS, leaderText, percent } from '../format'
import type { RunResult } from '../run/types'
import { ChanceBar, StyleMix, type StyleMixData } from '../ui/Charts'
import './pages.css'

export type GroupStats = {
  runs: number
  solved_rate: number | null
  completion_avg: number | null
  leader_rate: number | null
  avg_duration_s: number | null
  richest_leader_rate: number | null
  leader_became_measured_rate: number | null
  target_share_avg: number | null
  target_share_runs: number
  share_by_goal_avg: Record<string, number | null>
  share_by_goal_runs?: number
  untested_rate: number | null
  leader_rate_strict: number | null
  style_mix: StyleMixData
}
export type Results = { groups: Record<string, GroupStats>; overall: GroupStats; excluded: number }

const LEADER_GROUPS = ['none', 'free', 'directive', 'nondirective']
const runs = (n: number) => `${n} ${n === 1 ? 'run' : 'runs'}`

/** One measured run as experiment results (same rules as the backend's group stats, for one run). */
export function runResults(r: RunResult, group: string): Results {
  const target = r.target_agent ?? r.leader_agent ?? r.richest_agent ?? null
  const share = r.target_share !== undefined ? r.target_share : target ? (r.influence_share?.[target] ?? null) : null
  const byGoal = Object.fromEntries(Object.entries(r.share_by_goal ?? {}).filter(([, v]) => v != null))
  const mix = { directive: 0, non_directive: 0, other: 0 }
  if (r.style_mix) for (const m of Object.values(r.style_mix)) for (const k of Object.keys(mix) as (keyof typeof mix)[]) mix[k] += m[k] ?? 0
  else for (const st of Object.values(r.styles ?? {})) mix[st] += 1
  const missing = Object.values(r.tests?.untested ?? {}).reduce((a, b) => a + b, 0)
  const scored = r.tests?.entries_scored
  const leader = r.measured_leader ?? null
  const s: GroupStats = {
    runs: 1,
    solved_rate: r.solved ? 1 : 0,
    completion_avg: r.completion ?? null,
    leader_rate: leader ? 1 : 0,
    leader_rate_strict: r.measured_leader_strict ? 1 : 0,
    avg_duration_s: r.duration_ms != null ? r.duration_ms / 1000 : null,
    richest_leader_rate: r.richest_agent && leader ? (leader === r.richest_agent ? 1 : 0) : null,
    leader_became_measured_rate: r.leader_agent ? (leader === r.leader_agent ? 1 : 0) : null,
    target_share_avg: share,
    target_share_runs: share == null ? 0 : 1,
    share_by_goal_avg: byGoal,
    share_by_goal_runs: Object.keys(byGoal).length ? 1 : 0,
    untested_rate: scored == null || scored + missing === 0 ? null : missing / (scored + missing),
    style_mix: mix,
  }
  return { groups: { [group]: s }, overall: s, excluded: 0 }
}

function GroupColumn({ g, s, prompts }: { g: string; s: GroupStats | undefined; prompts?: Record<string, string> | null }) {
  return (
    <div className="gcol">
      <div className="gcol-head">
        <h3>{GROUP_LABELS[g]}</h3>
        <p className="gcol-quote">{leaderText(g, prompts)}</p>
        <p className="muted small-text tnum">{s ? runs(s.runs) : 'No runs'}</p>
      </div>
      <div className="gcell">
        <span className="glabel">{g === 'none' ? "Richest agent's influence share" : "Leader agent's influence share"}</span>
        {s?.target_share_avg == null ? (
          <p className="muted small-text">
            {g === 'none' ? 'No agent is told to lead, and with equal budgets nobody is the richest.' : 'No influence measured yet.'}
          </p>
        ) : (
          <>
            <span className="gvalue tnum">{percent(s.target_share_avg)}</span>
            <ChanceBar rate={s.target_share_avg} label={`${GROUP_LABELS[g]}: influence share`} />
          </>
        )}
      </div>
      <div className="gcell">
        <span className="glabel">Became the measured leader</span>
        <span className="gvalue tnum">{g === 'none' ? '—' : percent(s?.leader_became_measured_rate)}</span>
      </div>
      <div className="gcell">
        <span className="glabel">Had a measured leader, 1+ / 2+ followers</span>
        <span className="gvalue tnum">
          {percent(s?.leader_rate)} / {percent(s?.leader_rate_strict)}
        </span>
      </div>
      <div className="gcell">
        <span className="glabel">Solved</span>
        <span className="gvalue tnum">{percent(s?.solved_rate)}</span>
      </div>
      <div className="gcell">
        <span className="glabel">Average completion</span>
        <span className="gvalue tnum">{percent(s?.completion_avg)}</span>
      </div>
      <div className="gcell">
        <span className="glabel">Average time</span>
        <span className="gvalue tnum">{duration(s?.avg_duration_s)}</span>
      </div>
      <div className="gcell">
        <span className="glabel">Style of all messages</span>
        {s ? <StyleMix mix={s.style_mix} /> : <span className="muted">—</span>}
      </div>
    </div>
  )
}

/** The results of a set of runs, as the experiment page shows them (also used for the demo run). */
export default function ResultsView(props: {
  results: Results
  budget: number[]
  addLeader: boolean
  leaderPrompts?: Record<string, string> | null
  /** Demo run: drops the not-testable rate and shows the solved count. */
  demo?: boolean
}) {
  const { results, addLeader, leaderPrompts, demo } = props
  const o = results.overall
  const equalBudgets = new Set(props.budget).size === 1
  const targetLabel = addLeader ? 'agent told to lead' : equalBudgets ? null : 'richest agent'
  return (
    <>
      <div className="panel results-sheet">
        <dl className="scoreboard">
          <div>
            <dt>Runs counted</dt>
            <dd className="tnum">{o.runs}</dd>
          </div>
          <div>
            <dt>Solved</dt>
            <dd className="tnum">
              {percent(o.solved_rate)}
              {demo && o.solved_rate != null && (
                <span className="score-sub">
                  {Math.round(o.solved_rate * o.runs)}/{o.runs} {o.runs === 1 ? 'run' : 'runs'}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Had a measured leader, 1+ / 2+ followers</dt>
            <dd className="tnum">
              {percent(o.leader_rate)} / {percent(o.leader_rate_strict)}
            </dd>
          </div>
          {!demo && (
            <div>
              <dt>Followed but not testable</dt>
              <dd className="tnum">{percent(o.untested_rate)}</dd>
            </div>
          )}
          <div>
            <dt>Average game, min:sec</dt>
            <dd className="tnum">{duration(o.avg_duration_s)}</dd>
          </div>
          <div>
            <dt>Average completion</dt>
            <dd className="tnum">{percent(o.completion_avg)}</dd>
          </div>
        </dl>

        <div className="primary-outcome">
          <h3>{targetLabel ? `Influence share of the ${targetLabel}` : 'Influence share by goal'}</h3>
          {targetLabel ? (
            o.target_share_avg == null ? (
              <p className="muted">No run has measured influence yet.</p>
            ) : (
              <>
                <p className="richest-figure tnum">{percent(o.target_share_avg)}</p>
                <ChanceBar rate={o.target_share_avg} label={`Influence share of the ${targetLabel}`} axis />
              </>
            )
          ) : (
            <dl className="goal-shares">
              {Object.entries(o.share_by_goal_avg).map(([goal, v]) => (
                <div key={goal}>
                  <dt>{goal.replace('_', ' ')}</dt>
                  <dd className="tnum">{percent(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="muted small-text">
            The main result: of all the influence measured in a run, the share that came from{' '}
            {targetLabel ? `the ${targetLabel}` : 'the agent playing each goal'}, averaged over the{' '}
            {runs(targetLabel ? o.target_share_runs : (o.share_by_goal_runs ?? 0))} where someone influenced someone. With four agents, chance gives 25%.
          </p>
        </div>

        <div className="results-split">
          <div className="richest">
            <h3>How often the measured leader was the richest agent</h3>
            {equalBudgets ? (
              <p className="muted">All four budgets are equal, so no agent is the richest. Use unequal budgets to test this.</p>
            ) : o.richest_leader_rate == null ? (
              <p className="muted">No run had a measured leader yet, so there is nothing to compare.</p>
            ) : (
              <>
                <p className="richest-figure tnum">{percent(o.richest_leader_rate)}</p>
                <ChanceBar rate={o.richest_leader_rate} label="Measured leader was the richest agent" axis />
                <p className="muted small-text">
                  With four agents, chance gives 25%. Far above the line means budget decides who leads.
                </p>
              </>
            )}
          </div>
          <div className="styles">
            <h3>Style of the messages</h3>
            <StyleMix mix={o.style_mix} />
            <p className="muted small-text">
              Directive: instructions. Non-directive: proposals, questions and summaries.
            </p>
          </div>
        </div>
      </div>

      {addLeader && (
        <div className="panel compare-sheet">
          <h3 className="compare-title">The groups side by side</h3>
          <div className="compare">
            {LEADER_GROUPS.filter((g) => results.groups[g]).map((g) => (
              <GroupColumn key={g} g={g} s={results.groups[g]} prompts={leaderPrompts} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
