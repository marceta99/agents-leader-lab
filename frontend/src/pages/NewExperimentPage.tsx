import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useMe } from '../auth'
import { errorText, experimentName, GROUP_LABELS, LEADER_DEFAULTS, LEADER_MAX, leaderText, MODELS, money } from '../format'
import RequireAuth from '../RequireAuth'
import Field from '../ui/Field'
import './pages.css'

// Default global settings (backend settings_store DEFAULTS); the backend re-validates with the live values.
const BUDGET_MAX = 12
const BUDGET_MIN_TOTAL = 16

type Estimate = { runs_total: number; calls_estimate: number; usd_estimate: number }

const isInt = (s: string) => /^\d+$/.test(s.trim())

/** One form section: title and explanation on the left, controls on the right. */
function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="fs" aria-labelledby={id}>
      <div className="fs-head">
        <h2 id={id}>{title}</h2>
        {intro && <div className="fs-intro">{intro}</div>}
      </div>
      <div className="fs-body">{children}</div>
    </section>
  )
}

function Choice({
  name,
  checked,
  onChange,
  title,
  tag,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  title: string
  tag?: string
  children: ReactNode
}) {
  return (
    <label className="choice">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="choice-text">
        <span className="choice-title">
          {title}
          {tag && <span className="choice-tag">{tag}</span>}
        </span>
        <span className="choice-desc">{children}</span>
      </span>
    </label>
  )
}

function NewExperimentForm({ hasKey }: { hasKey: boolean }) {
  const navigate = useNavigate()
  const [knowAll, setKnowAll] = useState(false)
  const [budget, setBudget] = useState(['6', '6', '6', '6'])
  const [addLeader, setAddLeader] = useState(false)
  const [leaderPrompts, setLeaderPrompts] = useState<Record<string, string>>(LEADER_DEFAULTS)
  const [runs, setRuns] = useState('')
  const [model, setModel] = useState(MODELS[0].id)
  const [cap, setCap] = useState('5')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimateError, setEstimateError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const nums = budget.map(Number)
  const sum = nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  const cellErrors = budget.map((b) =>
    !isInt(b) ? 'Whole number' : Number(b) > BUDGET_MAX ? `At most ${BUDGET_MAX}` : '',
  )
  const totalShort = sum < BUDGET_MIN_TOTAL
  const budgetError = cellErrors.some(Boolean) || totalShort
  const runsN = Number(runs)
  const runsError = !isInt(runs) || runsN < 1 ? 'Enter a whole number, 1 or more.' : ''
  const capN = Number(cap)
  const capError = !(capN > 0) ? 'Enter an amount above $0, for example 5.' : ''
  const promptErrors = Object.fromEntries(
    Object.entries(leaderPrompts).map(([g, t]) => [
      g,
      !addLeader ? '' : !t.trim() ? 'Write what the leader is told, or reset to the default.' : t.length > LEADER_MAX ? `At most ${LEADER_MAX} characters.` : '',
    ]),
  )
  const promptError = Object.values(promptErrors).some(Boolean)
  const valid = !budgetError && !runsError && !capError

  const config = {
    know_all_goals: knowAll,
    budget: nums,
    add_leader: addLeader,
    runs: runsN,
    model,
    cap_usd: capN,
  }
  const configKey = JSON.stringify(config)
  const localRunsTotal = runsError ? null : runsN * (addLeader ? 4 : 1)
  const name = budgetError ? '—' : experimentName(config)

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

  const shownEstimate = valid ? estimate : null
  const overCap = !!shownEstimate && shownEstimate.usd_estimate > capN
  const blocker = !hasKey
    ? 'Add your API key to launch.'
    : !valid || promptError
      ? 'Fix the highlighted fields to launch.'
      : ''

  async function launch(e: FormEvent) {
    e.preventDefault()
    if (blocker) return
    setBusy(true)
    setError('')
    try {
      const json = { ...config, leader_prompts: addLeader ? leaderPrompts : null }
      const exp = await api<{ id: number }>('/api/experiments', { json })
      navigate(`/experiments/${exp.id}`, { state: { launched: true } })
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const costText = !valid ? '—' : shownEstimate ? money(shownEstimate.usd_estimate) : '…'
  const launchButton = (
    <button className="primary block" disabled={!!blocker || busy} aria-describedby="launch-note">
      {busy ? 'Launching…' : 'Launch experiment'}
    </button>
  )

  return (
    <form className="new-exp" onSubmit={launch} noValidate>
      <div className="panel form-sheet">
        <Section
          id="s-goals"
          title="Goals"
          intro={<p>Each agent has its own goal for the chairs. Whether they know each other's goals changes how much they need to talk.</p>}
        >
          <div className="choices two" role="radiogroup" aria-labelledby="s-goals">
            <Choice name="goals" checked={!knowAll} onChange={() => setKnowAll(false)} title="Each knows only its own" tag="Default">
              The normal setting. Nobody sees the whole picture.
            </Choice>
            <Choice name="goals" checked={knowAll} onChange={() => setKnowAll(true)} title="Everyone knows all goals">
              The comparison. If leaders appear just as often, hidden goals are not the reason.
            </Choice>
          </div>
        </Section>

        <Section
          id="s-budget"
          title="Budget"
          intro={
            <p>
              Actions each agent can spend in a run. The largest number moves to a different goal from layout to
              layout, and names are shuffled every run, so no goal or name is always the rich one.
            </p>
          }
        >
          <fieldset className="budget">
            <legend className="sr-only">Budget for each of the four agents</legend>
            {budget.map((b, i) => {
              const n = isInt(b) ? Math.min(Number(b), BUDGET_MAX) : 0
              return (
                <Field key={i} label={`Budget ${i + 1}`} error={cellErrors[i]} className="budget-cell">
                  {(c) => (
                    <>
                      <input
                        {...c}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={BUDGET_MAX}
                        value={b}
                        onChange={(e) => setBudget(budget.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                      <span className="pips" aria-hidden="true">
                        {Array.from({ length: BUDGET_MAX }, (_, k) => (
                          <span key={k} className={k < n ? 'on' : ''} />
                        ))}
                      </span>
                    </>
                  )}
                </Field>
              )
            })}
          </fieldset>
          <p className={totalShort ? 'budget-total bad' : 'budget-total'} aria-live="polite">
            <strong className="tnum">Total {sum}</strong>
            {totalShort
              ? ` is too low. Add ${BUDGET_MIN_TOTAL - sum} more so the total is at least ${BUDGET_MIN_TOTAL}.`
              : ` actions. Each agent at most ${BUDGET_MAX}, total at least ${BUDGET_MIN_TOTAL}.`}
          </p>
        </Section>

        <Section
          id="s-leader"
          title="Leader"
          intro={
            <p>
              Off, the experiment watches whether a leader emerges on its own. On, one agent is told to lead. Which goal
              gets the leader moves from layout to layout. The other three are not told.
            </p>
          }
        >
          <label className="switch-row">
            <input type="checkbox" role="switch" checked={addLeader} onChange={(e) => setAddLeader(e.target.checked)} />
            <span>
              <strong>Add a leader</strong>
              <span className="muted">Runs four groups on the same layouts.</span>
            </span>
          </label>
          {addLeader && (
            <div className="groups-preview">
              <p className="groups-note">
                <span className="chip">Cost ×4</span> Each group plays every run, so the experiment costs four times as
                much. What the leader agent is told, added at the end of its instructions. Edit any of them:
              </p>
              <ol className="group-list">
                <li>
                  <strong>{GROUP_LABELS.none}</strong>
                  <span>{leaderText('none')}</span>
                </li>
                {Object.keys(LEADER_DEFAULTS).map((g) => (
                  <li key={g}>
                    <Field
                      label={GROUP_LABELS[g]}
                      error={promptErrors[g]}
                      hint={
                        leaderPrompts[g] !== LEADER_DEFAULTS[g] ? (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => setLeaderPrompts({ ...leaderPrompts, [g]: LEADER_DEFAULTS[g] })}
                          >
                            Reset to default
                          </button>
                        ) : undefined
                      }
                    >
                      {(c) => (
                        <textarea
                          {...c}
                          rows={3}
                          maxLength={LEADER_MAX}
                          value={leaderPrompts[g]}
                          onChange={(e) => setLeaderPrompts({ ...leaderPrompts, [g]: e.target.value })}
                        />
                      )}
                    </Field>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Section>

        <Section id="s-runs" title="Runs">
          <Field
            label={addLeader ? 'Runs per group' : 'Runs'}
            error={runs !== '' ? runsError : ''}
            className="runs-field"
          >
            {(c) => (
              <input
                {...c}
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="10"
                value={runs}
                onChange={(e) => setRuns(e.target.value)}
              />
            )}
          </Field>
        </Section>

        <Section id="s-model" title="Model" intro={<p>Every agent in every run uses this model. Cost is relative to Haiku.</p>}>
          <div className="choices three" role="radiogroup" aria-labelledby="s-model">
            {MODELS.map((m) => (
              <Choice
                key={m.id}
                name="model"
                checked={model === m.id}
                onChange={() => setModel(m.id)}
                title={m.label.replace('Claude ', '')}
                tag={m.cost}
              >
                {m.blurb}
              </Choice>
            ))}
          </div>
        </Section>
      </div>

      <aside className="panel summary" aria-labelledby="summary-title">
        <h2 id="summary-title">Before you launch</h2>
        <p className="summary-name">
          <span className="muted small-text">Name</span>
          <strong>{name}</strong>
        </p>
        <dl className="summary-figures">
          <div>
            <dt>Runs in total</dt>
            <dd className="tnum">{shownEstimate?.runs_total ?? localRunsTotal ?? '—'}</dd>
          </div>
          <div>
            <dt>Estimated cost</dt>
            <dd className="tnum">{costText}</dd>
          </div>
        </dl>
        {!valid && (
          <p className="muted small-text">
            {budgetError
              ? 'Fix the budget to see the cost.'
              : runsError
                ? 'Enter the number of runs to see the cost.'
                : 'Enter a spending cap to see the cost.'}
          </p>
        )}
        {estimateError && <p className="form-error">{estimateError}</p>}
        <Field
          label="Spending cap"
          error={capError || (overCap ? 'The estimate is above this cap, so the experiment will stop early.' : '')}
          hint="The experiment stops when it reaches the cap. Finished runs are kept."
        >
          {(c) => (
            <div className="money-input">
              <span aria-hidden="true">$</span>
              <input
                {...c}
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </div>
          )}
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="summary-launch">{launchButton}</div>
        <p id="launch-note" className="launch-note">
          {blocker ? (
            !hasKey ? (
              <>
                <Link to="/settings/key">Add your API key</Link> to launch.
              </>
            ) : (
              blocker
            )
          ) : (
            'You pay Anthropic directly for every call.'
          )}
        </p>
        <Link to="/experiments" className="cancel-link">
          Cancel
        </Link>
      </aside>

      <div className="launch-bar" aria-hidden={false}>
        {valid ? (
          <p className="tnum">
            <strong>{costText}</strong>
            <span className="muted"> for {shownEstimate?.runs_total ?? localRunsTotal} runs</span>
          </p>
        ) : (
          <p className="muted small-text">Set the runs to see the cost.</p>
        )}
        <button className="primary" disabled={!!blocker || busy}>
          {busy ? 'Launching…' : 'Launch experiment'}
        </button>
      </div>
    </form>
  )
}

function NewExperiment() {
  const { me } = useMe()
  const hasKey = !!me?.has_key
  return (
    <div className="app-page">
      <header className="ph">
        <div>
          <h1>New experiment</h1>
          <p className="lede">Choose the settings once. Every run plays them on its own numbered layout.</p>
        </div>
      </header>
      {!hasKey && (
        <p className="banner">
          You need an Anthropic API key to launch. You can fill in the form and see the cost first.{' '}
          <Link to="/settings/key">Add your key</Link>
        </p>
      )}
      <NewExperimentForm hasKey={hasKey} />
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
