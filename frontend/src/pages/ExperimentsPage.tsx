import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useMe } from '../auth'
import { errorText, modelLabel, money, statusLabel, type ExperimentSummary } from '../format'
import RequireAuth from '../RequireAuth'
import './pages.css'

function NewExperimentButton() {
  const { me } = useMe()
  if (me?.has_key)
    return (
      <Link to="/experiments/new" className="button primary">
        New experiment
      </Link>
    )
  return (
    <span className="row">
      <button className="primary" disabled>
        New experiment
      </button>
      <span className="hint">
        <Link to="/settings/key">Add your Anthropic API key</Link> to run experiments.
      </span>
    </span>
  )
}

function ExperimentList() {
  const [list, setList] = useState<ExperimentSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<ExperimentSummary[]>('/api/experiments')
      .then(setList)
      .catch((e) => setError(errorText(e)))
  }, [])

  return (
    <div className="page">
      <div className="spread">
        <h1>Experiments</h1>
        <NewExperimentButton />
      </div>
      <div className="panel">
        {error && <p className="error">{error}</p>}
        {!list && !error && <p className="muted">Loading…</p>}
        {list?.length === 0 && <p className="muted">No experiments yet.</p>}
        {list && list.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Runs</th>
                  <th>Spent / cap</th>
                  <th>Model</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link to={`/experiments/${e.id}`}>{e.name}</Link>
                    </td>
                    <td>
                      <span className={`badge ${e.status}`}>{statusLabel(e.status)}</span>
                    </td>
                    <td>
                      {e.runs_done} / {e.runs_total}
                    </td>
                    <td>
                      {money(e.spent_usd)} / {money(e.cap_usd)}
                    </td>
                    <td>{modelLabel(e.model)}</td>
                    <td>{new Date(e.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
