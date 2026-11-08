import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useMe } from '../auth'
import { dateLabel, errorText, modelLabel, money, type ExperimentSummary } from '../format'
import RequireAuth from '../RequireAuth'
import { Meter } from '../ui/Charts'
import { StatusBadge } from '../ui/Labels'
import './pages.css'

function NewExperimentButton({ hasKey }: { hasKey: boolean }) {
  if (hasKey)
    return (
      <Link to="/experiments/new" className="button primary">
        New experiment
      </Link>
    )
  return (
    <div className="ph-action-note">
      <button className="primary" disabled aria-describedby="no-key-note">
        New experiment
      </button>
      <p id="no-key-note">
        <Link to="/settings/key">Add your Anthropic API key</Link> to run experiments.
      </p>
    </div>
  )
}

function Row({ e }: { e: ExperimentSummary }) {
  return (
    <li>
      <Link to={`/experiments/${e.id}`} className="exp-row">
        <span className="exp-name">
          <strong>{e.name}</strong>
          <span className="muted">
            {modelLabel(e.model)}
            {e.add_leader ? ', with a leader' : ''}. Created {dateLabel(e.created_at)}
          </span>
        </span>
        <span className="exp-status">
          <StatusBadge status={e.status} />
        </span>
        <span className="exp-progress">
          <span className="exp-figure tnum">
            {e.runs_done} of {e.runs_total} runs
          </span>
          <Meter value={e.runs_done} max={e.runs_total} label={`${e.name}: runs done`} />
        </span>
        <span className="exp-spent">
          <span className="exp-figure tnum">{money(e.spent_usd)}</span>
          <span className="muted tnum">of {money(e.cap_usd)} cap</span>
        </span>
      </Link>
    </li>
  )
}

function ExperimentList() {
  const { me } = useMe()
  const hasKey = !!me?.has_key
  const [list, setList] = useState<ExperimentSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<ExperimentSummary[]>('/api/experiments')
      .then(setList)
      .catch((e) => setError(errorText(e)))
  }, [])

  return (
    <div className="app-page">
      <header className="ph">
        <div>
          <h1>Experiments</h1>
          <p className="lede">Each experiment plays the chairs game on numbered layouts and measures who led.</p>
        </div>
        <NewExperimentButton hasKey={hasKey} />
      </header>

      {error && (
        <div className="panel problem" role="alert">
          <p>Your experiments could not be loaded: {error}</p>
          <button onClick={() => location.reload()}>Try again</button>
        </div>
      )}

      {!list && !error && (
        <div className="panel exp-list" aria-busy="true">
          <p className="sr-only" role="status">
            Loading experiments…
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-row" aria-hidden="true">
              <span className="skeleton" style={{ width: '40%' }} />
              <span className="skeleton" style={{ width: '22%' }} />
            </div>
          ))}
        </div>
      )}

      {list?.length === 0 && (
        <div className="panel empty">
          <h2>No experiments yet.</h2>
          <p>
            Create your first one: pick a budget for the four agents, choose how many runs, and launch. You will see
            who led, and whether the richest agent was the one in charge.
          </p>
          {hasKey ? (
            <Link to="/experiments/new" className="button primary">
              New experiment
            </Link>
          ) : (
            <>
              <p className="muted">First, add the Anthropic API key the experiments will run on.</p>
              <Link to="/settings/key" className="button primary">
                Add API key
              </Link>
            </>
          )}
        </div>
      )}

      {list && list.length > 0 && (
        <ul className="panel exp-list" aria-label="Your experiments">
          {list.map((e) => (
            <Row key={e.id} e={e} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ExperimentsPage() {
  return (
    <RequireAuth>
      <ExperimentList />
    </RequireAuth>
  )
}
