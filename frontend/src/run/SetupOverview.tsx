import { useState } from 'react'
import { GROUP_LABELS, LEADER_STYLES, MODELS, leaderText } from '../format'
import { goalLabel } from '../pages/AgentsSection'
import { useDefaultPrompts } from '../prompts'
import { GOAL_IDS, isGoalId, type AgentState, type RunInfo, type RunSetup } from './types'

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
export default function SetupOverview({ setup, run, agents }: { setup: RunSetup; run: RunInfo; agents: AgentState[] }) {
  const [promptsOpen, setPromptsOpen] = useState(false)
  const defaults = useDefaultPrompts(promptsOpen)
  const goals = setup.goals ?? GOAL_IDS
  const prompts = setup.agent_prompts ?? goals.map(() => null)
  const nCustomGoals = goals.filter((g) => !isGoalId(g)).length
  const nCustomPrompts = prompts.filter(Boolean).length
  const nameOf = (g: string) => agents.find((a) => a.goal === g)?.name
  const slot = (i: number) => `Agent ${i + 1}${nameOf(goals[i]) ? ` · ${nameOf(goals[i])} in this run` : ''}`
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
          label="Agents"
          options={['1', '2', '3', '4', '5', '6', '7', '8']}
          chosen="4"
          note="Teams of 1 to 8 agents are coming in a future release."
        />
        <div className="su-row">
          <dt>Goals</dt>
          <dd>
            <details className="su-drop">
              <summary>{nCustomGoals ? `${nCustomGoals} custom, ${4 - nCustomGoals} built-in` : 'The 4 built-in goals'}</summary>
              <ol className="su-list">
                {goals.map((g, i) => (
                  <li key={i}>
                    <span className="su-slot">{slot(i)}</span>
                    {goalLabel(g)}
                    {!isGoalId(g) && <span className="su-tag">Custom goal</span>}
                  </li>
                ))}
              </ol>
            </details>
          </dd>
        </div>
        <div className="su-row">
          <dt>Prompts</dt>
          <dd>
            <details className="su-drop" onToggle={(e) => setPromptsOpen((e.target as HTMLDetailsElement).open)}>
              <summary>{nCustomPrompts ? `${nCustomPrompts} custom agent ${nCustomPrompts === 1 ? 'prompt' : 'prompts'}` : 'Default agent prompts'}</summary>
              <ol className="su-list">
                {prompts.map((p, i) => (
                  <li key={i}>
                    <span className="su-slot">
                      {slot(i)}
                      <span className="su-tag">{p ? 'Custom prompt' : 'Default prompt'}</span>
                    </span>
                    <pre className="su-pre">{p ?? defaults?.agent_prompt ?? 'Loading…'}</pre>
                  </li>
                ))}
                <li>
                  <span className="su-slot">Rules (system prompt), the same for every agent</span>
                  <pre className="su-pre">{defaults?.rules ?? 'Loading…'}</pre>
                </li>
              </ol>
            </details>
          </dd>
        </div>
        <Row
          label="What they know"
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
