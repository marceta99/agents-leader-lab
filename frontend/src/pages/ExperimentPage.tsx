import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import {
  dateLabel,
  errorText,
  groupLabel,
  modelLabel,
  money,
  percent,
  stopReasonText,
  type ExperimentSummary,
  type RunSummary,
} from '../format'
import RequireAuth from '../RequireAuth'
import { Meter } from '../ui/Charts'
import ConfirmButton from '../ui/ConfirmButton'
import { AgentName, BackLink, StatusBadge } from '../ui/Labels'
import './pages.css'
import ResultsView, { type Results } from './ResultsView'
import { GOAL_IDS, type GoalId } from '../run/types'

type Config = {
  know_all_goals: boolean
  budget: number[]
  add_leader: boolean
  runs: number
  model: string
  leader_prompts?: Record<string, string> | null
  goals?: string[] | null
  agent_prompts?: (string | null)[] | null
  cap_usd: number
  settings?: Record<string, unknown>
}
type Detail = ExperimentSummary & { config: Config; stop_reason: string | null; runs: RunSummary[] }

const ACTIVE = ['queued', 'running', 'measuring', 'paused']
const FILTERS = [
  ['any', 'All runs'],
  ['leader_is_richest', 'Leader is the richest agent'],
  ['leader_not_richest', 'Leader is not the richest agent'],
] as const

function ShareRow({ runId, cols, onClose }: { runId: number; cols: number; onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const link = token ? `${location.origin}/r/${token}` : ''

  useEffect(() => {
    api<{ token: string }>(`/api/runs/${runId}/share`, { method: 'POST' })
      .then((r) => setToken(r.token))
      .catch((e) => setError(errorText(e)))
  }, [runId])

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copying is blocked in this browser. Select the link and copy it by hand.')
    }
  }
  async function unshare() {
    setError('')
    try {
      await api(`/api/runs/${runId}/share`, { method: 'DELETE' })
      onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <tr className="share-row">
      <td colSpan={cols}>
        <div className="share-box">
          <p>Anyone with this link can watch the replay and results of this run. They never see your key or other runs.</p>
          {token ? (
            <div className="share-controls">
              <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Public link to this run" />
              <button type="button" className="primary" onClick={copy}>
                {copied ? 'Link copied' : 'Copy link'}
              </button>
              <button type="button" onClick={unshare}>
                Stop sharing
              </button>
            </div>
          ) : (
            !error && <p className="muted">Creating link…</p>
          )}
          {error && <p className="form-error">{error}</p>}
          <span className="sr-only" role="status">
            {copied ? 'Link copied' : ''}
          </span>
        </div>
      </td>
    </tr>
  )
}

function RunRow({ r, showGroup, leader, rich, firstOfLayout, cols }: { r: RunSummary; showGroup: boolean; leader: boolean; rich: boolean; firstOfLayout: boolean; cols: number }) {
  const [sharing, setSharing] = useState(false)
  return (
    <>
      <tr className={firstOfLayout ? 'layout-start' : undefined}>
        <td data-label="Layout" className="tnum cell-layout">
          #{r.layout_no}
        </td>
        {showGroup && (
          <td data-label="Group" className="cell-group">
            {groupLabel(r.group)}
          </td>
        )}
        <td data-label="Status">
          <StatusBadge status={r.status} />
        </td>
        <td data-label="Solved">{r.solved == null ? '—' : r.solved ? '✓ Solved' : 'Not solved'}</td>
        <td data-label="Completion" className="tnum">
          {percent(r.completion)}
        </td>
        <td data-label="Measured leader">
          {r.measured_leader ? <AgentName name={r.measured_leader} /> : r.status === 'finished' ? 'No leader' : '—'}
        </td>
        {leader && <td data-label="Told to lead">{r.leader_agent ? <AgentName name={r.leader_agent} /> : '—'}</td>}
        {rich && <td data-label="Rich agent">{r.rich_agent ? <AgentName name={r.rich_agent} /> : '—'}</td>}
        <td data-label="Cost" className="tnum">
          {money(r.cost_usd)}
        </td>
        <td className="cell-actions">
          {r.status !== 'queued' && (
            <Link to={`/runs/${r.id}`} className="button compact">
              {r.status === 'running' ? 'Watch' : 'Replay'}
              <span className="sr-only">
                {' '}
                layout {r.layout_no} {showGroup ? groupLabel(r.group) : ''}
              </span>
            </Link>
          )}
          {r.status === 'finished' && (
            <button type="button" className="compact ghost-line" aria-expanded={sharing} onClick={() => setSharing((s) => !s)}>
              {sharing ? 'Hide link' : 'Share'}
            </button>
          )}
        </td>
      </tr>
      {sharing && <ShareRow runId={r.id} cols={cols} onClose={() => setSharing(false)} />}
    </>
  )
}

function RunsTable({ exp }: { exp: Detail }) {
  const showGroup = exp.runs.some((r) => r.group !== 'none')
  const leader = exp.config.add_leader
  const rich = new Set(exp.config.budget).size > 1
  const cols = 7 + (showGroup ? 1 : 0) + (leader ? 1 : 0) + (rich ? 1 : 0)
  return (
    <section className="block" aria-labelledby="runs-title">
      <div className="block-head">
        <h2 id="runs-title">Runs</h2>
        <p className="muted">
          {leader ? 'Each layout is played once by every group.' : 'One run per layout.'} Open a run to watch it in the
          room.
        </p>
      </div>
      <div className="panel runs-sheet">
        <table className="runs">
          <thead>
            <tr>
              <th scope="col">Layout</th>
              {showGroup && <th scope="col">Group</th>}
              <th scope="col">Status</th>
              <th scope="col">Solved</th>
              <th scope="col">Completion</th>
              <th scope="col">Measured leader</th>
              {leader && <th scope="col">Told to lead</th>}
              {rich && (
                <th scope="col" title="The agent with the most actions">
                  Rich agent
                </th>
              )}
              <th scope="col">Cost</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {exp.runs.map((r, i) => (
              <RunRow
                key={r.id}
                r={r}
                showGroup={showGroup}
                leader={leader}
                rich={rich}
                cols={cols}
                firstOfLayout={i > 0 && exp.runs[i - 1].layout_no !== r.layout_no}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ResultsSection({ exp }: { exp: Detail }) {
  const [richest, setRichest] = useState('any')
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  // Refetch when the filter changes or another run finishes.
  useEffect(() => {
    let stale = false
    api<Results>(`/api/experiments/${exp.id}/results?richest=${richest}`)
      .then((r) => {
        if (stale) return
        setResults(r)
        setError('')
      })
      .catch((e) => !stale && setError(errorText(e)))
    return () => {
      stale = true
    }
  }, [exp.id, richest, exp.runs_done, exp.status, attempt])

  const o = results?.overall

  return (
    <section className="block" aria-labelledby="results-title">
      <div className="block-head spread">
        <div>
          <h2 id="results-title">Results</h2>
          <p className="muted">Finished, fully measured runs only.</p>
        </div>
        <div className="actions">
          <a className="button" href={`/api/experiments/${exp.id}/export.json`} download>
            Download JSON
          </a>
          <a className="button" href={`/api/experiments/${exp.id}/export.zip`} download>
            Download CSV (zip)
          </a>
        </div>
      </div>

      {exp.config.add_leader && (
        <fieldset className="segmented">
          <legend className="sr-only">Which runs to count</legend>
          {FILTERS.map(([v, label]) => (
            <label key={v}>
              <input type="radio" name="richest" value={v} checked={richest === v} onChange={() => setRichest(v)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      )}

      {error && (
        <div className="panel problem" role="alert">
          <p>The results could not be loaded: {error}</p>
          <button onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </div>
      )}
      {!results && !error && (
        <div className="panel" aria-busy="true">
          <p className="muted" role="status">
            Loading results…
          </p>
        </div>
      )}

      {o && results && o.runs === 0 && (
        <div className="panel empty">
          <h3>No results yet.</h3>
          <p>
            {ACTIVE.includes(exp.status)
              ? 'Results appear here as soon as the first run is played and measured. Measuring takes a minute or two after each game.'
              : richest !== 'any'
                ? 'No finished run matches this filter. Choose All runs to see everything.'
                : 'No run finished, so there is nothing to measure.'}
          </p>
        </div>
      )}

      {o && results && o.runs > 0 && (
        <ResultsView
          results={results}
          budget={exp.config.budget}
          addLeader={exp.config.add_leader}
          leaderPrompts={exp.config.leader_prompts}
        />
      )}
      {results && results.excluded > 0 && (
        <p className="muted small-text">
          {results.excluded} {results.excluded === 1 ? 'run was' : 'runs were'} stopped, failed or only partly measured,
          and {results.excluded === 1 ? 'is' : 'are'} left out of these numbers.
        </p>
      )}
    </section>
  )
}

function Experiment() {
  const { id } = useParams()
  const navigate = useNavigate()
  const launched = !!(useLocation().state as { launched?: boolean } | null)?.launched
  const [exp, setExp] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      api<Detail>(`/api/experiments/${id}`)
        .then((d) => {
          setExp(d)
          setError('')
        })
        .catch((e) => setError(errorText(e))),
    [id],
  )

  useEffect(() => {
    load()
  }, [load])

  const active = !!exp && ACTIVE.includes(exp.status)
  useEffect(() => {
    if (!active) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [active, load])

  async function post(action: 'stop' | 'pause' | 'resume') {
    setBusy(true)
    try {
      await api(`/api/experiments/${id}/${action}`, { method: 'POST' })
      await load()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const stop = () => post('stop')
  async function remove() {
    try {
      await api(`/api/experiments/${id}`, { method: 'DELETE' })
      navigate('/experiments')
    } catch (e) {
      setError(errorText(e))
    }
  }

  if (!exp)
    return error ? (
      <div className="app-page">
        <div className="panel problem" role="alert">
          <p>This experiment could not be loaded: {error}</p>
          <Link to="/experiments" className="button">
            Back to experiments
          </Link>
        </div>
      </div>
    ) : (
      <div className="app-page" aria-busy="true">
        <p className="sr-only" role="status">
          Loading experiment…
        </p>
        <span className="skeleton skeleton-title" aria-hidden="true" />
        <div className="panel skeleton-sheet" aria-hidden="true" />
      </div>
    )

  const c = exp.config
  const paused = exp.status === 'paused'
  const finishing = paused && exp.runs.some((r) => r.status === 'running' || r.status === 'measuring')
  const runsBlock = <RunsTable exp={exp} />
  const resultsBlock = <ResultsSection exp={exp} />

  return (
    <div className="app-page">
      <BackLink to="/experiments">All experiments</BackLink>
      {launched && active && (
        <p className="banner ok" role="status">
          Experiment launched. Runs start in a moment, and this page updates by itself.
        </p>
      )}

      {paused && (
        <p className="banner" role="status">
          {finishing
            ? 'Pausing. The run that is playing finishes and is measured; no new run starts until you resume.'
            : 'Paused. No run is playing. Resume to continue with the next run.'}
        </p>
      )}

      <header className="ph exp-ph">
        <div>
          <StatusBadge status={exp.status} />
          <h1 className="exp-title">{exp.name}</h1>
          <p className="lede">
            {modelLabel(c.model)}. Created {dateLabel(exp.created_at)}.
          </p>
        </div>
        <div className="actions">
          {(exp.status === 'queued' || exp.status === 'running') && (
            <button type="button" onClick={() => post('pause')} disabled={busy}>
              Pause experiment
            </button>
          )}
          {paused && (
            <button type="button" className="primary" onClick={() => post('resume')} disabled={busy}>
              Resume experiment
            </button>
          )}
          {active && (
            <ConfirmButton
              label="Stop experiment"
              question="Stop this experiment? Finished runs are kept."
              confirmLabel="Stop experiment"
              busyLabel="Stopping…"
              onConfirm={stop}
            />
          )}
          <ConfirmButton
            label="Delete experiment"
            question="Delete this experiment and all its runs? This cannot be undone."
            confirmLabel="Delete experiment"
            busyLabel="Deleting…"
            onConfirm={remove}
          />
        </div>
      </header>

      {exp.stop_reason && (
        <p className="banner warn">
          <strong>Why it stopped:</strong> {stopReasonText(exp.stop_reason)}
        </p>
      )}
      {error && (
        <p className="banner bad" role="alert">
          {error}
        </p>
      )}

      <section className="panel overview" aria-label="Progress and settings">
        <div className="overview-progress">
          <div>
            <p className="overview-figure tnum">
              {exp.runs_done}
              <span> of {exp.runs_total}</span>
            </p>
            <p className="muted">runs done</p>
            <Meter value={exp.runs_done} max={exp.runs_total} label="Runs done" />
          </div>
          <div>
            <p className="overview-figure tnum">
              {money(exp.spent_usd)}
              <span> of {money(exp.cap_usd)}</span>
            </p>
            <p className="muted">spent of the cap</p>
            <Meter value={exp.spent_usd} max={exp.cap_usd} label="Money spent of the cap" />
          </div>
        </div>
        <dl className="spec">
          <div>
            <dt>Goals</dt>
            <dd>{c.know_all_goals ? 'Everyone knows all' : 'Each knows its own'}</dd>
          </div>
          <div>
            <dt>Agent goals and prompts</dt>
            <dd>
              {c.goals ? `${c.goals.filter((g) => !GOAL_IDS.includes(g as GoalId)).length} custom goals` : 'Built-in goals'},{' '}
              {c.agent_prompts?.some(Boolean) ? `${c.agent_prompts.filter(Boolean).length} custom prompts` : 'default prompts'}
            </dd>
          </div>
          <div>
            <dt>Budget, rotated across goals</dt>
            <dd className="tnum">{c.budget.join(' / ')}</dd>
          </div>
          <div>
            <dt>Leader</dt>
            <dd>{c.add_leader ? `Added, ${new Set(exp.runs.map((r) => r.group)).size} groups` : 'None'}</dd>
          </div>
          <div>
            <dt>Runs</dt>
            <dd className="tnum">
              {c.runs}
              {c.add_leader ? ' per group' : ''}
            </dd>
          </div>
          <div>
            <dt>Model effort</dt>
            <dd>{c.settings?.effort != null ? String(c.settings.effort).replace(/^./, (x) => x.toUpperCase()) : '—'}</dd>
          </div>
        </dl>
      </section>

      {/* While runs play, the run list (Watch) matters most; once done, the results do. */}
      {active ? (
        <>
          {runsBlock}
          {resultsBlock}
        </>
      ) : (
        <>
          {resultsBlock}
          {runsBlock}
        </>
      )}
    </div>
  )
}

export default function ExperimentPage() {
  return (
    <RequireAuth>
      <Experiment />
    </RequireAuth>
  )
}
