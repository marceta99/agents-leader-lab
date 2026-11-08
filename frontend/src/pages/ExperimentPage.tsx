import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import {
  duration,
  errorText,
  GROUP_LABELS,
  groupLabel,
  modelLabel,
  money,
  percent,
  statusLabel,
  yesNo,
  type ExperimentSummary,
  type RunSummary,
} from '../format'
import RequireAuth from '../RequireAuth'
import './pages.css'

type Config = {
  know_all_goals: boolean
  budget: number[]
  add_leader: boolean
  runs: number
  solo_baseline: boolean
  model: string
  cap_usd: number
  settings?: Record<string, unknown>
}
type Detail = ExperimentSummary & { config: Config; stop_reason: string | null; runs: RunSummary[] }
type StyleMix = { directive: number; non_directive: number; other: number }
type GroupStats = {
  runs: number
  solved_rate: number | null
  leader_rate: number | null
  avg_duration_s: number | null
  richest_leader_rate: number | null
  leader_became_measured_rate: number | null
  leader_share_avg: number | null
  style_mix: StyleMix
}
type Results = { groups: Record<string, GroupStats>; overall: GroupStats; excluded: number }

const ACTIVE = ['queued', 'running', 'measuring']
const LEADER_GROUPS = ['none', 'free', 'directive', 'nondirective']

/** Bar of a 0..1 rate with the 25% chance line. */
function ChanceBar({ rate }: { rate: number | null }) {
  return (
    <div className="bar" title="Dashed line: 25% chance">
      <div className="bar-fill" style={{ width: `${(rate ?? 0) * 100}%` }} />
      <div className="bar-chance" />
    </div>
  )
}

function StyleBar({ mix }: { mix: StyleMix }) {
  const total = mix.directive + mix.non_directive + mix.other
  if (!total) return <span className="muted">—</span>
  const parts = [
    ['Directive', mix.directive, 'var(--directive)'],
    ['Non-directive', mix.non_directive, 'var(--non-directive)'],
    ['Other', mix.other, 'var(--other)'],
  ] as const
  return (
    <div>
      <div className="stack">
        {parts.map(([label, n, color]) => (
          <div key={label} title={`${label}: ${percent(n / total)}`} style={{ width: `${(n / total) * 100}%`, background: color }} />
        ))}
      </div>
      <div className="legend">
        {parts.map(([label, n, color]) => (
          <span key={label}>
            <span className="dot" style={{ background: color }} />
            {label} {percent(n / total)}
          </span>
        ))}
      </div>
    </div>
  )
}

function Tile({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="tile">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {children}
    </div>
  )
}

function ShareCell({ runId }: { runId: number }) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const link = token ? `${location.origin}/r/${token}` : ''

  async function share() {
    setError('')
    try {
      setToken((await api<{ token: string }>(`/api/runs/${runId}/share`, { method: 'POST' })).token)
    } catch (e) {
      setError(errorText(e))
    }
  }
  async function unshare() {
    setError('')
    try {
      await api(`/api/runs/${runId}/share`, { method: 'DELETE' })
      setToken(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  if (!token)
    return (
      <>
        <button className="small" onClick={share}>
          Share
        </button>
        {error && <span className="error"> {error}</span>}
      </>
    )
  return (
    <div className="share-link">
      <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Public link" />
      <button className="small" onClick={() => navigator.clipboard?.writeText(link)}>
        Copy
      </button>
      <button className="small" onClick={unshare}>
        Stop sharing
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  )
}

function ResultsSection({ exp }: { exp: Detail }) {
  const [richest, setRichest] = useState('any')
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState('')

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
  }, [exp.id, richest, exp.runs_done, exp.status])

  const o = results?.overall
  return (
    <section className="panel">
      <div className="spread">
        <h2>Results</h2>
        <div className="row">
          {exp.config.add_leader && (
            <select value={richest} onChange={(e) => setRichest(e.target.value)} aria-label="Filter runs">
              <option value="any">All runs</option>
              <option value="leader_is_richest">Leader is the richest agent</option>
              <option value="leader_not_richest">Leader is not the richest agent</option>
            </select>
          )}
          <a className="button" href={`/api/experiments/${exp.id}/export.json`} download>
            Export JSON
          </a>
          <a className="button" href={`/api/experiments/${exp.id}/export.zip`} download>
            Export CSV (zip)
          </a>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!results && !error && <p className="muted">Loading…</p>}
      {o && results && (
        <>
          <div className="tiles">
            <Tile label="Runs counted" value={String(o.runs)} />
            <Tile label="Solve rate" value={percent(o.solved_rate)} />
            <Tile label="Runs with a measured leader" value={percent(o.leader_rate)} />
            <Tile label="Average game length" value={duration(o.avg_duration_s)} />
            <Tile label="Measured leader was the richest agent" value={percent(o.richest_leader_rate)}>
              <ChanceBar rate={o.richest_leader_rate} />
              <span className="hint">Dashed line: 25% chance. Far above it means budget decides who leads.</span>
            </Tile>
            <Tile label="Style mix of messages" value="">
              <StyleBar mix={o.style_mix} />
            </Tile>
            {results.groups.solo && (
              <Tile label="Solo baseline solve rate" value={percent(results.groups.solo.solved_rate)}>
                <span className="hint">{results.groups.solo.runs} solo runs</span>
              </Tile>
            )}
          </div>

          {exp.config.add_leader && (
            <>
              <h3 style={{ marginTop: 16 }}>Groups side by side</h3>
              <div className="groups">
                {LEADER_GROUPS.map((g) => {
                  const s = results.groups[g]
                  return (
                    <div key={g} className="tile">
                      <strong>{GROUP_LABELS[g]}</strong>
                      {!s ? (
                        <span className="muted">No runs</span>
                      ) : (
                        <>
                          <span className="hint">{s.runs} runs</span>
                          <span className="label">Leader agent's influence share: {percent(s.leader_share_avg)}</span>
                          <ChanceBar rate={s.leader_share_avg} />
                          <span className="label">Solve rate: {percent(s.solved_rate)}</span>
                          <span className="label">Average time: {duration(s.avg_duration_s)}</span>
                          <span className="label">
                            Leader agent became the measured leader: {percent(s.leader_became_measured_rate)}
                          </span>
                          <span className="label">Style mix</span>
                          <StyleBar mix={s.style_mix} />
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
          {results.excluded > 0 && (
            <p className="hint" style={{ marginTop: 12 }}>
              {results.excluded} {results.excluded === 1 ? 'run was' : 'runs were'} stopped, failed or only partly
              measured, and {results.excluded === 1 ? 'is' : 'are'} left out of these numbers.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function RunsTable({ exp }: { exp: Detail }) {
  const showGroup = exp.runs.some((r) => r.group !== 'none')
  const leader = exp.config.add_leader
  return (
    <section className="panel">
      <h2>Runs</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Layout</th>
              {showGroup && <th>Group</th>}
              <th>Status</th>
              <th>Solved</th>
              <th>Measured leader</th>
              {leader && <th>Leader agent</th>}
              <th>Cost</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {exp.runs.map((r) => (
              <tr key={r.id}>
                <td>#{r.layout_no}</td>
                {showGroup && <td>{groupLabel(r.group)}</td>}
                <td>
                  <span className={`badge ${r.status}`}>{statusLabel(r.status)}</span>
                </td>
                <td>{yesNo(r.solved)}</td>
                <td>{r.measured_leader ?? (r.status === 'finished' ? 'No leader' : '—')}</td>
                {leader && <td>{r.leader_agent ?? '—'}</td>}
                <td>{money(r.cost_usd)}</td>
                <td>
                  {r.status !== 'queued' && <Link to={`/runs/${r.id}`}>{r.status === 'running' ? 'Watch' : 'Replay'}</Link>}
                </td>
                <td>{r.status === 'finished' && <ShareCell runId={r.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Experiment() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [exp, setExp] = useState<Detail | null>(null)
  const [error, setError] = useState('')

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

  async function stop() {
    if (!confirm('Stop this experiment? Finished runs are kept.')) return
    try {
      await api(`/api/experiments/${id}/stop`, { method: 'POST' })
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }
  async function remove() {
    if (!confirm('Delete this experiment and all its runs? This cannot be undone.')) return
    try {
      await api(`/api/experiments/${id}`, { method: 'DELETE' })
      navigate('/experiments')
    } catch (e) {
      setError(errorText(e))
    }
  }

  if (!exp) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>
  const c = exp.config
  const progress = exp.runs_total ? exp.runs_done / exp.runs_total : 0

  return (
    <div className="page">
      <section className="panel">
        <div className="spread">
          <div>
            <h1>{exp.name}</h1>
            <span className={`badge ${exp.status}`}>{statusLabel(exp.status)}</span>
            {exp.stop_reason && <span className="muted"> Stopped: {exp.stop_reason}</span>}
          </div>
          <div className="row">
            {active && (
              <button className="danger" onClick={stop}>
                Stop
              </button>
            )}
            <button className="danger" onClick={remove}>
              Delete
            </button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="spread hint">
            <span>
              {exp.runs_done} of {exp.runs_total} runs done
            </span>
            <span>
              {money(exp.spent_usd)} spent of {money(exp.cap_usd)} cap
            </span>
          </div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="panel">
        <h2>Settings</h2>
        <dl className="summary">
          <dt>Agents know all goals</dt>
          <dd>{c.know_all_goals ? 'On' : 'Off'}</dd>
          <dt>Budget</dt>
          <dd>{c.budget.join(' / ')} (dealt at random each run)</dd>
          <dt>Add a leader</dt>
          <dd>{c.add_leader ? 'On (4 groups)' : 'Off'}</dd>
          <dt>Runs</dt>
          <dd>
            {c.runs}
            {c.add_leader ? ' per group' : ''}
          </dd>
          <dt>Solo baseline</dt>
          <dd>{c.solo_baseline ? 'On' : 'Off'}</dd>
          <dt>Model</dt>
          <dd>{modelLabel(c.model)}</dd>
          <dt>Spending cap</dt>
          <dd>{money(c.cap_usd)}</dd>
          {c.settings?.effort != null && (
            <>
              <dt>Model effort</dt>
              <dd>{String(c.settings.effort)}</dd>
            </>
          )}
        </dl>
      </section>

      <RunsTable exp={exp} />
      <ResultsSection exp={exp} />
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
