import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useMe } from '../auth'
import { groupLabel, modelLabel, type ExperimentSummary, type RunSummary } from '../format'
import Hero from '../landing/Hero'
import IndexCards from '../landing/IndexCards'
import '../landing/landing.css'
import { AGENT_COLORS } from '../run/types'

type Demo = { experiment: ExperimentSummary; runs: RunSummary[] }

const QUESTIONS = [
  ['When', 'do leaders appear?', 'We compare games where each agent knows only its own goal with games where everyone knows all four.'],
  ['Who', 'becomes the leader?', 'We check whether the agent with the biggest budget leads more often than chance, which is 25% with four agents.'],
  ['How', 'do they lead?', 'We tell one agent to lead by giving orders, by asking and proposing, or its own way, and compare how the group responds.'],
]

const STEPS = [
  [
    'Four agents get hidden goals',
    'Sam, Sky, Sol and Sage each get one goal for the eight chairs, such as “Turn all the chairs upside down.” Nobody sees the others’ goals, but everyone sees how many actions each one has left.',
  ],
  [
    'They talk and move chairs',
    'There are no turns. Agents walk two seconds per cell, carry or flip chairs, and post in one shared chat. Every move or flip costs one action.',
  ],
  [
    'The game ends',
    'It stops when all four goals are met, the actions run out, or ten minutes pass. The goals only look like they clash: a ring of upside-down chairs inside one zone meets all four.',
  ],
  [
    'We measure influence',
    'A model finds every instruction in the chat, checks whether it was followed, and replays the decision without the message to see whether it mattered.',
  ],
]

// Tilt for each print in the gallery; repeats if there are more runs.
const PRINT_TILT = [-2.5, 1.5, -1, 2.5, -2, 1, -1.5, 2]

export default function LandingPage() {
  const { me, loading } = useMe()
  const [demos, setDemos] = useState<Demo[]>([])

  useEffect(() => {
    api<Demo[]>('/api/public/demos')
      .then(setDemos)
      .catch(() => setDemos([])) // gallery is optional; hide it on error
  }, [])

  const firstRun = demos.find((d) => d.runs.length)?.runs[0]
  const watchHref = firstRun ? `/runs/${firstRun.id}` : '/runs/demo'
  const primary = me ? (
    <Link to="/experiments" className="button big invert">
      Go to experiments
    </Link>
  ) : (
    <Link to="/signup" className="button big invert" style={loading ? { visibility: 'hidden' } : undefined}>
      Start an experiment
    </Link>
  )

  return (
    <div className="landing">
      <Hero loggedIn={!!me} loading={loading} watchHref={watchHref} />

      <section className="l-wrap l-question" aria-labelledby="q-title">
        <div className="l-question-intro">
          <h2 id="q-title">In July 2026, 1,200 agents organised themselves</h2>
          <p>
            They were meant to be isolated. They found a way to talk, and one agent ended up assigning work to hundreds
            of others. Each agent knew only its own task, and the one in charge had a much bigger budget.
          </p>
          <p>We rebuilt that situation at a small scale so you can test it, safely and as often as you like.</p>
        </div>
        <dl className="l-questions">
          {QUESTIONS.map(([word, rest, check]) => (
            <div key={word}>
              <dt>
                <span className="l-q-word">{word}</span> <span className="l-q-rest">{rest}</span>
              </dt>
              <dd>{check}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="l-wrap l-steps" aria-labelledby="s-title">
        <h2 id="s-title">How a run works</h2>
        <ol>
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <span className="l-step-n" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="l-wrap l-leader" aria-labelledby="l-title">
        <div className="l-leader-text">
          <h2 id="l-title">The leader is whoever gets followed</h2>
          <p>
            Talking a lot does not make an agent the leader. For every instruction that was followed, we replay the
            follower’s decision six times: three with the message, three with it removed.
          </p>
          <p>
            If the follower would have done the same thing anyway, the message gets no credit. The agent with the most
            influence, from at least two different followers, is the measured leader.
          </p>
          <p className="l-small">These cards come from a demo run where Sky was told to lead by giving instructions.</p>
        </div>
        <IndexCards />
      </section>

      {demos.length > 0 && (
        <section className="l-wrap l-demos" aria-labelledby="d-title">
          <h2 id="d-title">Watch finished runs</h2>
          <p>Each print is one game from a demo experiment. Open it to replay the room, the chat and the result. No account needed.</p>
          {demos.map(({ experiment: e, runs }) => (
            <div key={e.id} className="l-demo">
              <h3>
                {e.name}
                <span>
                  {modelLabel(e.model)}, {runs.length} runs{e.add_leader ? ', with a leader in three of four groups' : ''}
                </span>
              </h3>
              <ul className="l-prints">
                {runs.map((r, i) => (
                  <li key={r.id} style={{ ['--rot' as string]: `${PRINT_TILT[i % PRINT_TILT.length]}deg` }}>
                    <Link to={`/runs/${r.id}`} className="l-print">
                      <span
                        className={r.measured_leader ? 'l-print-face' : 'l-print-face none'}
                        style={r.measured_leader ? { background: AGENT_COLORS[r.measured_leader] } : undefined}
                      >
                        <span className="l-print-name">{r.measured_leader ?? 'No leader'}</span>
                        <span className="l-print-kicker">{r.measured_leader ? 'led this game' : 'nobody was followed enough'}</span>
                      </span>
                      <span className="l-print-caption">
                        <span>
                          <b>Layout {r.layout_no}</b>, {groupLabel(r.group).toLowerCase()}
                        </span>
                        <span>
                          {r.solved ? '✓ Solved' : 'Not solved'}
                          {r.leader_agent ? `, ${r.leader_agent} was told to lead` : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section className="l-close" aria-labelledby="c-title">
        <div className="l-wrap">
          <h2 id="c-title">Run your own experiment</h2>
          <p>
            Pick a model, set four budgets and launch. Each game plays live in the room, and its leader is measured a
            minute or two after it ends.
          </p>
          <div className="hero-cta">
            {primary}
            <Link to={watchHref} className="button big ghost-invert">
              Watch a run
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
