import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useMe } from '../auth'
import { errorText, MODELS, type ExperimentSummary } from '../format'
import RequireAuth from '../RequireAuth'
import Field from '../ui/Field'
import { StatusBadge } from '../ui/Labels'
import './pages.css'

type Settings = Record<string, unknown>
type NumberField = { key: string; label: string; unit: string; step: number; hint?: string }

// Numeric keys of settings_store DEFAULTS, grouped the way an admin thinks about them.
const GROUPS: { id: string; title: string; intro: string; fields: NumberField[] }[] = [
  {
    id: 'timing',
    title: 'Game timing',
    intro: 'How fast the room moves and how long a game may last.',
    fields: [
      { key: 'cell_seconds', label: 'Walking speed', unit: 's per cell', step: 0.05 },
      { key: 'flip_seconds', label: 'Flip time', unit: 's', step: 0.05 },
      { key: 'time_limit_s', label: 'Time limit per run', unit: 's', step: 1 },
      { key: 'heartbeat_s', label: 'Ask an idle agent again after', unit: 's', step: 1, hint: 'Seconds with no change in the room.' },
      { key: 'min_call_gap_s', label: 'Gap between two questions to one agent', unit: 's', step: 0.5 },
    ],
  },
  {
    id: 'limits',
    title: 'Limits',
    intro: 'Caps that keep runs and keys within reason.',
    fields: [
      { key: 'call_limit', label: 'Question limit', unit: 'per agent', step: 1, hint: 'Times each agent can be asked in one run.' },
      { key: 'max_runs', label: 'Maximum runs per experiment', unit: 'runs', step: 1, hint: 'Per group when a leader is added.' },
      { key: 'parallel_runs', label: 'Runs at the same time, per experiment', unit: 'runs', step: 1 },
      { key: 'global_run_cap', label: 'Runs at the same time, whole platform', unit: 'runs', step: 1 },
    ],
  },
  {
    id: 'budget',
    title: 'Budget rules',
    intro: 'What users may enter as the four agent budgets.',
    fields: [
      { key: 'budget_max_per_agent', label: 'Maximum budget per agent', unit: 'actions', step: 1 },
      { key: 'budget_min_total', label: 'Minimum total budget', unit: 'actions', step: 1 },
    ],
  },
  {
    id: 'measurement',
    title: 'Measurement',
    intro: 'When the most influential agent counts as the measured leader.',
    fields: [{ key: 'min_influence', label: 'Minimum influence for a measured leader', unit: 'score', step: 0.05 }],
  },
]
const NUMBER_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key))
const EFFORTS = [
  ['low', 'Low', 'Cheapest and fastest. The default.'],
  ['medium', 'Medium', 'Thinks more before each move.'],
  ['high', 'High', 'Thinks the most. Slow and costly.'],
] as const

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

  if (!settings)
    return error ? (
      <p className="banner bad">{error}</p>
    ) : (
      <p className="muted" role="status">
        Loading settings…
      </p>
    )

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
    for (const key of NUMBER_KEYS) body[key] = Number(body[key])
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
    <form onSubmit={save}>
      <div className="panel form-sheet">
        {GROUPS.map((g) => (
          <section key={g.id} className="fs" aria-labelledby={`g-${g.id}`}>
            <div className="fs-head">
              <h2 id={`g-${g.id}`}>{g.title}</h2>
              <p className="fs-intro">{g.intro}</p>
            </div>
            <div className="fs-body settings-grid">
              {g.fields.map((f) => {
                const v = String(settings[f.key] ?? '')
                const bad = v === '' || !(Number(v) >= 0)
                return (
                  <Field key={f.key} label={f.label} hint={f.hint} error={bad ? 'Enter a number, 0 or more.' : ''}>
                    {(c) => (
                      <div className="unit-input">
                        <input
                          {...c}
                          type="number"
                          inputMode="decimal"
                          required
                          min={0}
                          step={f.step}
                          value={v}
                          onChange={(e) => set(f.key, e.target.value)}
                        />
                        <span>{f.unit}</span>
                      </div>
                    )}
                  </Field>
                )
              })}
            </div>
          </section>
        ))}

        <section className="fs" aria-labelledby="g-models">
          <div className="fs-head">
            <h2 id="g-models">Models and effort</h2>
            <p className="fs-intro">Which models users can pick, and how much each one thinks before it answers.</p>
          </div>
          <div className="fs-body">
            <fieldset className="plain">
              <legend>Available models</legend>
              {MODELS.map((m) => (
                <label key={m.id} className="switch-row">
                  <input
                    type="checkbox"
                    checked={models.includes(m.id)}
                    onChange={(e) => set('models', e.target.checked ? [...models, m.id] : models.filter((x) => x !== m.id))}
                  />
                  <span>
                    <strong>{m.label}</strong>
                    <span className="muted">{m.cost} the cost of Haiku</span>
                  </span>
                </label>
              ))}
              {models.length === 0 && <p className="field-error">Keep at least one model available.</p>}
            </fieldset>
            <fieldset className="plain">
              <legend>Model effort</legend>
              <div className="choices row3">
                {EFFORTS.map(([v, label, desc]) => (
                  <label key={v} className="choice">
                    <input type="radio" name="effort" checked={String(settings.effort ?? 'low') === v} onChange={() => set('effort', v)} />
                    <span className="choice-text">
                      <span className="choice-title">{label}</span>
                      <span className="choice-desc">{desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>
      </div>

      <div className="save-bar">
        <div className="actions">
          <span role="status" className="saved-note">
            {saved ? 'Settings saved.' : ''}
          </span>
          <button className="primary" disabled={busy || models.length === 0}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
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
    <div className="panel">
      {error && <p className="form-error">{error}</p>}
      {!list && !error && (
        <p className="muted" role="status">
          Loading experiments…
        </p>
      )}
      {list?.length === 0 && (
        <p className="muted">
          You have no experiments yet. <Link to="/experiments/new">Create one</Link>, then pick it here.
        </p>
      )}
      {list && list.length > 0 && (
        <ul className="demo-list">
          {list.map((e) => (
            <li key={e.id}>
              <label className="switch-row">
                <input type="checkbox" role="switch" checked={e.is_demo} onChange={(ev) => toggle(e.id, ev.target.checked)} />
                <span>
                  <strong>{e.name}</strong>
                  <span className="muted">{e.is_demo ? 'Shown on the landing page' : 'Not shown'}</span>
                </span>
              </label>
              <span className="demo-meta">
                <StatusBadge status={e.status} />
                <Link to={`/experiments/${e.id}`}>Open</Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Admin() {
  const { me } = useMe()
  if (!me?.is_admin)
    return (
      <div className="app-page">
        <div className="panel empty">
          <h2>Admins only.</h2>
          <p>This page is for accounts with the admin role. <Link to="/experiments">Go to your experiments</Link>.</p>
        </div>
      </div>
    )
  return (
    <div className="app-page">
      <header className="ph">
        <div>
          <h1>Admin</h1>
          <p className="lede">Global settings for new experiments, and which experiments the landing page shows.</p>
        </div>
      </header>
      <section className="block" aria-labelledby="settings-title">
        <div className="block-head">
          <h2 id="settings-title">Global settings</h2>
          <p className="muted">New experiments copy these settings when they are created. Running ones keep their own.</p>
        </div>
        <SettingsForm />
      </section>
      <section className="block" aria-labelledby="demos-title">
        <div className="block-head">
          <h2 id="demos-title">Demo experiments</h2>
          <p className="muted">Visitors can watch every run of the experiments you switch on, without an account.</p>
        </div>
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
