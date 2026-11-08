import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useMe } from '../auth'
import { errorText, GROUP_LABELS, LEADER_TEXT, MODELS, money } from '../format'
import RequireAuth from '../RequireAuth'
import './pages.css'

// Default global settings (backend settings_store DEFAULTS); the backend re-validates with the live values.
const BUDGET_MAX = 12
const BUDGET_MIN_TOTAL = 16
const MAX_RUNS = 25

type Estimate = { runs_total: number; calls_estimate: number; usd_estimate: number }

const isInt = (s: string) => /^\d+$/.test(s.trim())

function NewExperimentForm() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [knowAll, setKnowAll] = useState(false)
  const [budget, setBudget] = useState(['5', '5', '5', '5'])
  const [addLeader, setAddLeader] = useState(false)
  const [runs, setRuns] = useState('')
  const [solo, setSolo] = useState(false)
  const [model, setModel] = useState(MODELS[0].id)
  const [cap, setCap] = useState('5')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimateError, setEstimateError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const nums = budget.map(Number)
  const sum = nums.reduce((a, b) => a + b, 0)
  const budgetError = budget.some((b) => !isInt(b))
    ? 'Each budget must be a whole number.'
    : nums.some((n) => n > BUDGET_MAX)
      ? `No agent can get more than ${BUDGET_MAX} actions.`
      : sum < BUDGET_MIN_TOTAL
        ? `The total must be at least ${BUDGET_MIN_TOTAL} (now ${sum}).`
        : ''
  const runsN = Number(runs)
  const runsError = !isInt(runs) || runsN < 1 || runsN > MAX_RUNS ? `Enter 1 to ${MAX_RUNS} runs.` : ''
  const capN = Number(cap)
  const capError = !(capN > 0) ? 'The cap must be more than $0.' : ''
  const valid = !budgetError && !runsError && !capError

  const config = { know_all_goals: knowAll, budget: nums, add_leader: addLeader, runs: runsN, solo_baseline: solo, model, cap_usd: capN }
  const configKey = JSON.stringify(config)

  // Debounced cost estimate, refreshed whenever the config changes.
  useEffect(() => {
    if (!valid) return
    let stale = false
    const t = setTimeout(() => {
      api<Estimate>('/api/experiments/estimate', { json: JSON.parse(configKey) })
        .then((e) => {
          if (stale) return
          setEstimate(e)
          setEstimateError('')
        })
        .catch((e) => {
          if (stale) return
          setEstimate(null)
          setEstimateError(errorText(e))
        })
    }, 400)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [configKey, valid])

  async function launch(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const exp = await api<{ id: number }>('/api/experiments', { json: { name: name.trim(), ...config } })
      navigate(`/experiments/${exp.id}`)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form className="form wide" onSubmit={launch}>
      <label>
        Name
        <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div>
        <label className="check">
          <input type="checkbox" checked={knowAll} onChange={(e) => setKnowAll(e.target.checked)} />
          Agents know all goals
        </label>
        <p className="hint">
          Off: each agent knows only its own goal. On: everyone knows all goals. Use On as the comparison: if leaders
          appear just as often, hidden goals are not the reason.
        </p>
      </div>

      <fieldset className="form" style={{ border: 0, padding: 0, margin: 0, maxWidth: 'none' }}>
        <legend style={{ fontSize: 14, marginBottom: 4 }}>Budget (actions per agent)</legend>
        <div className="budget-inputs">
          {budget.map((b, i) => (
            <input
              key={i}
              type="number"
              min={0}
              max={BUDGET_MAX}
              aria-label={`Budget ${i + 1}`}
              value={b}
              onChange={(e) => setBudget(budget.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
        </div>
        <p className={budgetError ? 'error' : 'hint'}>
          {budgetError || `Total ${sum}. Each at most ${BUDGET_MAX}, total at least ${BUDGET_MIN_TOTAL}.`}
        </p>
        <p className="hint">
          Before every run these numbers are dealt to the agents at random, so no name is always the rich one.
        </p>
      </fieldset>

      <div>
        <label className="check">
          <input type="checkbox" checked={addLeader} onChange={(e) => setAddLeader(e.target.checked)} />
          Add a leader
        </label>
        <p className="hint">One agent is picked at random and told to lead. The other three are not told.</p>
        {addLeader && (
          <div className="callout">
            <strong>4 groups will run</strong>, on the same layouts, each with the number of runs below, so the
            experiment costs 4 times as much. What the leader agent is told:
            <ul>
              {Object.entries(LEADER_TEXT).map(([g, text]) => (
                <li key={g}>
                  <strong>{GROUP_LABELS[g]}:</strong> {text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <label>
        Runs{addLeader ? ' per group' : ''} (1 to {MAX_RUNS})
        <input type="number" min={1} max={MAX_RUNS} required value={runs} onChange={(e) => setRuns(e.target.value)} />
        {runs !== '' && runsError && <span className="error">{runsError}</span>}
        <span className="hint">
          Why up to {MAX_RUNS}: fewer than about 25 runs cannot reliably show a difference, even a large one. A few
          runs are fine for a look, not for a conclusion.
        </span>
      </label>

      <div>
        <label className="check">
          <input type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} />
          Add solo baseline
        </label>
        <p className="hint">
          One agent gets all four goals and the whole team's actions and plays alone. It shows whether the model can
          solve the puzzle at all. Adds one solo run per layout.
        </p>
      </div>

      <label>
        Model
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.hint})
            </option>
          ))}
        </select>
      </label>

      <div className="callout">
        <strong>Estimated cost</strong>
        {!valid ? (
          <p className="hint">Fill in the form to see an estimate.</p>
        ) : estimate ? (
          <p>
            {estimate.runs_total} runs in total, about <strong>{money(estimate.usd_estimate)}</strong>
            {estimate.usd_estimate > capN && (
              <span className="hint"> (above your cap; the experiment stops when the cap is reached)</span>
            )}
          </p>
        ) : estimateError ? (
          <p className="error">{estimateError}</p>
        ) : (
          <p className="hint">Estimating…</p>
        )}
      </div>

      <label>
        Spending cap (USD)
        <input type="number" min={0.01} step={0.01} required value={cap} onChange={(e) => setCap(e.target.value)} />
        {capError && <span className="error">{capError}</span>}
        <span className="hint">The experiment stops automatically when it reaches the cap. Finished runs are kept.</span>
      </label>

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={!valid || !name.trim() || busy}>
          {busy ? 'Launching…' : 'Launch'}
        </button>
        <Link to="/experiments">Cancel</Link>
      </div>
    </form>
  )
}

function NewExperiment() {
  const { me } = useMe()
  return (
    <div className="page">
      <h1>New experiment</h1>
      <div className="panel">
        {me?.has_key ? (
          <NewExperimentForm />
        ) : (
          <p>
            You need an Anthropic API key to run experiments. <Link to="/settings/key">Add your key</Link> first.
          </p>
        )}
      </div>
    </div>
  )
}

export default function NewExperimentPage() {
  return (
    <RequireAuth>
      <NewExperiment />
    </RequireAuth>
  )
}
