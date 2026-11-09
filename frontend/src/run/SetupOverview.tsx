import { GROUP_LABELS, LEADER_STYLES, MODELS, leaderText } from '../format'
import type { RunInfo, RunSetup } from './types'

/** One setting: every option the experiment form offered, the chosen one marked. */
function Row(props: { label: string; options: string[]; chosen: string; note?: string | null }) {
  return (
    <div className="su-row">
      <dt>{props.label}</dt>
      <dd>
        <ul className="su-options">
          {props.options.map((o) => (
            <li key={o} className={o === props.chosen ? 'on' : undefined}>
              {o === props.chosen && <span aria-hidden="true">✓ </span>}
              {o}
              {o === props.chosen && <span className="rv-sr"> (chosen)</span>}
            </li>
          ))}
        </ul>
        {props.note && <p className="su-note">{props.note}</p>}
      </dd>
    </div>
  )
}

/** How the run's experiment was set up, so a visitor sees the choices behind the replay. */
export default function SetupOverview({ setup, run }: { setup: RunSetup; run: RunInfo }) {
  const budget = setup.budget ?? []
  const equal = new Set(budget).size <= 1
  const rich = run.result?.richest_agent
  const groups = ['none', ...LEADER_STYLES, ...(run.group === 'free' ? ['free'] : [])]
  const told = run.result?.leader_agent
  return (
    <section className="su panel" aria-labelledby="su-title">
      <div className="su-head">
        <h2 id="su-title">How this experiment was set up</h2>
        <p className="muted">
          The options offered when the experiment was created; the chosen ones are dark. Layout {run.layout_no}
          {setup.runs ? `, one of ${setup.runs} ${setup.add_leader ? 'layouts, each played by both leader styles' : 'runs'}` : ''}.
        </p>
      </div>
      <dl className="su-rows">
        <Row
          label="Goals"
          options={['Each knows only its own', 'Everyone knows all goals']}
          chosen={setup.know_all_goals ? 'Everyone knows all goals' : 'Each knows only its own'}
        />
        <Row
          label="Budget"
          options={['Equal', 'Unequal']}
          chosen={equal ? 'Equal' : 'Unequal'}
          note={`${budget.join(' / ')} actions${!equal && rich ? `. ${rich} got the most.` : ''}`}
        />
        <Row
          label="Leader"
          options={groups.map((g) => GROUP_LABELS[g])}
          chosen={GROUP_LABELS[run.group] ?? run.group}
          note={run.group === 'none' ? null : `${told ?? 'One agent'} was told: ${leaderText(run.group, setup.leader_prompts)}`}
        />
        <Row label="Model" options={MODELS.map((m) => m.label)} chosen={MODELS.find((m) => m.id === setup.model)?.label ?? setup.model} />
      </dl>
    </section>
  )
}
