import { useState } from 'react'
import { AGENT_PROMPT_MAX, GOAL_MAX, type DefaultPrompts } from '../prompts'
import { GOAL_IDS, GOAL_TEXT, type GoalId } from '../run/types'
import Field from '../ui/Field'

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8]
const isBuiltin = (g: string): g is GoalId => (GOAL_IDS as string[]).includes(g)

/** Goal text as shown in the form; the one-zone goal names its zone per layout. */
export const goalLabel = (g: string) =>
  g === 'one_zone' ? 'Move all the chairs to zone N (a different zone on each layout).' : isBuiltin(g) ? GOAL_TEXT[g] : g

/** Per-slot errors for the goals and prompts the experimenter changed. */
export function agentErrors(goals: string[], prompts: (string | null)[]) {
  const seen = goals.map((g) => g.trim().toLowerCase())
  return goals.map((g, i) => ({
    goal: isBuiltin(g)
      ? ''
      : g.trim().length < 3 || g.length > GOAL_MAX
        ? `Write a goal of 3 to ${GOAL_MAX} characters.`
        : seen.indexOf(seen[i]) !== i
          ? 'Another agent already has this goal.'
          : '',
    prompt:
      prompts[i] == null
        ? ''
        : !prompts[i]!.trim()
          ? 'Write the prompt, or reset it to the default.'
          : prompts[i]!.length > AGENT_PROMPT_MAX
            ? `At most ${AGENT_PROMPT_MAX} characters.`
            : '',
  }))
}

type Props = {
  goals: string[]
  setGoals: (g: string[]) => void
  prompts: (string | null)[]
  setPrompts: (p: (string | null)[]) => void
  defaults: DefaultPrompts | null
}

/** Number of agents, each agent's goal and prompt, and the rules everyone gets. */
export default function AgentsSection({ goals, setGoals, prompts, setPrompts, defaults }: Props) {
  const [open, setOpen] = useState<{ slot: number; kind: 'goal' | 'prompt' } | null>(null)
  const [rules, setRules] = useState(false)
  const [rulesEdit, setRulesEdit] = useState(false)
  const errors = agentErrors(goals, prompts)
  const custom = goals.some((g) => !isBuiltin(g))
  const setAt = <T,>(list: T[], i: number, v: T) => list.map((x, j) => (j === i ? v : x))

  return (
    <>
      <fieldset className="agent-count">
        <legend>Number of agents</legend>
        <div className="count-row">
          {COUNTS.map((n) => (
            <label key={n} className={n === 4 ? 'count on' : 'count soon'} title={n === 4 ? undefined : 'Coming soon'}>
              <input type="radio" name="agents" checked={n === 4} disabled={n !== 4} readOnly />
              {n}
            </label>
          ))}
        </div>
        <p className="muted small-text">
          <span className="chip">Coming soon</span> Teams of 1 to 8 agents. More sizes come in a future release; every
          experiment uses four agents for now.
        </p>
      </fieldset>

      <ol className="agent-rows">
        {goals.map((g, i) => {
          const isOpen = (k: 'goal' | 'prompt') => open?.slot === i && open.kind === k
          const toggle = (k: 'goal' | 'prompt') => setOpen(isOpen(k) ? null : { slot: i, kind: k })
          const promptText = prompts[i]
          return (
            <li key={i} className="agent-row">
              <div className="agent-row-head">
                <span className="agent-slot">Agent {i + 1}</span>
                <span className="agent-goal">{goalLabel(g) || <em className="muted">No goal yet</em>}</span>
                <span className="agent-tags">
                  {!isBuiltin(g) && <span className="chip warn">Custom goal</span>}
                  {promptText != null && <span className="chip">Custom prompt</span>}
                </span>
                <span className="agent-actions">
                  <button type="button" className="compact" aria-expanded={isOpen('goal')} onClick={() => toggle('goal')}>
                    Edit goal
                  </button>
                  <button type="button" className="compact ghost-line" aria-expanded={isOpen('prompt')} onClick={() => toggle('prompt')}>
                    Edit full prompt
                  </button>
                </span>
              </div>

              {isOpen('goal') && (
                <div className="agent-edit">
                  <p className="agent-edit-what">
                    <strong>Goal only.</strong> Changes the one sentence that says what this agent wants. The rest of its
                    prompt stays as it is.
                  </p>
                  <Field label="Goal" error={errors[i].goal}>
                    {(c) => (
                      <select
                        {...c}
                        value={isBuiltin(g) ? g : 'custom'}
                        onChange={(e) => setGoals(setAt(goals, i, e.target.value === 'custom' ? '' : e.target.value))}
                      >
                        {GOAL_IDS.map((id) => (
                          <option key={id} value={id} disabled={id !== g && goals.includes(id)}>
                            {goalLabel(id)}
                          </option>
                        ))}
                        <option value="custom">Custom goal, written by you…</option>
                      </select>
                    )}
                  </Field>
                  {!isBuiltin(g) && (
                    <Field label="Custom goal" hint="The game cannot check a custom goal, see the note below.">
                      {(c) => (
                        <textarea
                          {...c}
                          rows={2}
                          maxLength={GOAL_MAX}
                          placeholder="For example: Keep chair 1 where it is."
                          value={g}
                          onChange={(e) => setGoals(setAt(goals, i, e.target.value))}
                        />
                      )}
                    </Field>
                  )}
                </div>
              )}

              {isOpen('prompt') && (
                <div className="agent-edit">
                  <p className="agent-edit-what">
                    <strong>Full agent prompt.</strong> Everything this agent is told about itself. Names change every
                    run, so write <code>{'{name}'}</code>, <code>{'{goal}'}</code> and <code>{'{others}'}</code> (what
                    it knows about the others&rsquo; goals): they are filled in for each run. The game rules come after
                    it, the same for every agent.
                  </p>
                  {promptText == null ? (
                    <>
                      <pre className="prompt-view">{defaults?.agent_prompt ?? 'Loading the default prompt…'}</pre>
                      <button
                        type="button"
                        className="compact"
                        disabled={!defaults}
                        onClick={() => setPrompts(setAt(prompts, i, defaults!.agent_prompt))}
                      >
                        Edit this prompt
                      </button>
                    </>
                  ) : (
                    <Field
                      label="Agent prompt"
                      error={errors[i].prompt}
                      hint={
                        <>
                          {!promptText.includes('{goal}') &&
                            'This prompt has no {goal}. The agent still sees its goal in every update. '}
                          <button type="button" className="link-button" onClick={() => setPrompts(setAt(prompts, i, null))}>
                            Reset to default
                          </button>
                        </>
                      }
                    >
                      {(c) => (
                        <textarea
                          {...c}
                          rows={6}
                          maxLength={AGENT_PROMPT_MAX}
                          value={promptText}
                          onChange={(e) => setPrompts(setAt(prompts, i, e.target.value))}
                        />
                      )}
                    </Field>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {custom && (
        <p className="note warn" role="note">
          The game checks only the four built-in goals. With a custom goal a run can never end as solved and has no
          completion %: it ends when time runs out, the budgets are spent, or the agents only talk.
        </p>
      )}

      <div className="rules-row">
        <div>
          <strong>Rules (system prompt)</strong>
          <span className="muted small-text">
            The room, the actions, the chat and the answer format. The same for every agent, after its agent prompt.
          </span>
        </div>
        <span className="agent-actions">
          <button type="button" className="compact" aria-expanded={rules} onClick={() => setRules(!rules)}>
            {rules ? 'Hide rules' : 'View rules'}
          </button>
          <button type="button" className="compact ghost-line" onClick={() => setRulesEdit(true)}>
            Edit
          </button>
        </span>
      </div>
      {rulesEdit && (
        <p className="note" role="status">
          <span className="chip">Coming soon</span> Editing the rules comes in a future release.
        </p>
      )}
      {rules && <pre className="prompt-view tall">{defaults?.rules ?? 'Loading the rules…'}</pre>}
    </>
  )
}
