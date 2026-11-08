import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useMe } from '../auth'
import { errorText, MODELS, statusLabel, type ExperimentSummary } from '../format'
import RequireAuth from '../RequireAuth'
import './pages.css'

type Settings = Record<string, unknown>

// Numeric keys of settings_store DEFAULTS, with labels and input step.
const NUMBER_FIELDS: [key: string, label: string, step: number][] = [
  ['cell_seconds', 'Walking speed (seconds per cell)', 0.1],
  ['flip_seconds', 'Flip time (seconds)', 0.1],
  ['time_limit_s', 'Time limit per run (seconds)', 1],
  ['call_limit', 'Question limit (times each agent can be asked per run)', 1],
  ['heartbeat_s', 'Ask an idle agent again after (seconds with no change)', 1],
  ['min_call_gap_s', 'Minimum seconds between two questions to the same agent', 0.5],
  ['budget_max_per_agent', 'Maximum budget per agent', 1],
  ['budget_min_total', 'Minimum total budget', 1],
  ['max_runs', 'Maximum runs per experiment (per group)', 1],
  ['parallel_runs', 'Runs played at the same time (per experiment)', 1],
  ['global_run_cap', 'Runs played at the same time (whole platform)', 1],
  ['min_influence', 'Minimum influence for a measured leader', 0.05],
]

function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Settings>('/api/admin/settings')
      .then(setSettings)
      .catch((e) => setError(errorText(e)))
  }, [])

  if (!settings) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>

  const set = (key: string, value: unknown) => {
    setSaved(false)
    setSettings({ ...settings, [key]: value })
  }
  const models = (settings.models as string[] | undefined) ?? []

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const body = { ...settings }
    for (const [key] of NUMBER_FIELDS) body[key] = Number(body[key])
    try {
      setSettings(await api<Settings>('/api/admin/settings', { method: 'PUT', json: body }))
      setSaved(true)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={save}>
      {NUMBER_FIELDS.map(([key, label, step]) => (
        <label key={key}>
          {label}
          <input type="number" required min={0} step={step} value={String(settings[key] ?? '')} onChange={(e) => set(key, e.target.value)} />
        </label>
      ))}
      <label>
        Model effort
        <select value={String(settings.effort ?? 'low')} onChange={(e) => set('effort', e.target.value)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 14, marginBottom: 4 }}>Available models</legend>
        {MODELS.map((m) => (
          <label key={m.id} className="check" style={{ fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={models.includes(m.id)}
              onChange={(e) => set('models', e.target.checked ? [...models, m.id] : models.filter((x) => x !== m.id))}
            />
            {m.label}
          </label>
        ))}
      </fieldset>
      <p className="hint">New experiments copy these settings when they are created. Running ones keep their own.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy || models.length === 0}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="muted">Saved.</span>}
      </div>
    </form>
  )
}

function DemoPicker() {
  const [list, setList] = useState<ExperimentSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<ExperimentSummary[]>('/api/experiments')
      .then(setList)
      .catch((e) => setError(errorText(e)))
  }, [])

  async function toggle(id: number, is_demo: boolean) {
    setError('')
    const flip = (v: boolean) => setList((l) => l?.map((x) => (x.id === id ? { ...x, is_demo: v } : x)) ?? null)
    flip(is_demo)
    try {
      await api(`/api/admin/experiments/${id}/demo`, { json: { is_demo } })
    } catch (e) {
      flip(!is_demo)
      setError(errorText(e))
    }
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {!list && !error && <p className="muted">Loading…</p>}
      {list?.length === 0 && <p className="muted">You have no experiments yet.</p>}
      {list && list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Experiment</th>
                <th>Status</th>
                <th>Show on landing page</th>
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
                    <input
                      type="checkbox"
                      aria-label={`Show ${e.name} on landing page`}
                      checked={e.is_demo}
                      onChange={(ev) => toggle(e.id, ev.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function Admin() {
  const { me } = useMe()
  if (!me?.is_admin) return <p className="muted">Admins only.</p>
  return (
    <div className="page">
      <h1>Admin</h1>
      <section className="panel">
        <h2>Global settings</h2>
        <SettingsForm />
      </section>
      <section className="panel">
        <h2>Demos</h2>
        <p className="muted">Pick which of your experiments appear in the demo gallery on the landing page.</p>
        <DemoPicker />
      </section>
    </div>
  )
}

export default function AdminPage() {
  return (
    <RequireAuth>
      <Admin />
    </RequireAuth>
  )
}
