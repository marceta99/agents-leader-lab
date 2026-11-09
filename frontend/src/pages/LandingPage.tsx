import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useMe } from '../auth'
import { groupLabel, modelLabel, type ExperimentSummary, type RunSummary } from '../format'
import Hero from '../landing/Hero'
import IndexCards from '../landing/IndexCards'
import '../landing/landing.css'
import { AGENT_COLORS } from '../run/types'
import { DemoRun } from './DemoPage'

type Demo = { experiment: ExperimentSummary; runs: RunSummary[] }

const QUESTIONS = [
  ['When', 'does a leader appear?', 'Agents that know only their own goal, against agents that know all four.'],
  ['Who', 'becomes the leader?', 'Whether the agent with the largest budget leads more often than chance (25%).'],
  ['How', 'does it lead?', 'Directive (decide and assign) against non-directive (frame, propose, ask, summarise).'],
]

// What an experiment can change, in the order the form asks. `soon`: shown, not yet available.
const VARY: { name: string; text: string; soon?: boolean }[] = [
  { name: 'Number of agents', text: 'Teams of 1 to 8 agents. Every experiment uses four for now.', soon: true },
  { name: 'Goals', text: 'Keep the four built-in goals, or write your own for any agent.' },
  { name: 'Prompts', text: 'Edit just an agent’s goal, or rewrite everything it is told about itself.' },
  { name: 'Budgets', text: 'Equal actions for all, or one agent far richer than the rest.' },
  { name: 'Who knows what', text: 'Each agent knows only its own goal, or everyone knows all of them.' },
  { name: 'Leader style', text: 'No leader, or one agent told to lead, directive or non-directive, in your own words.' },
  { name: 'Model', text: 'Claude Haiku, Sonnet or Opus. More models are coming.' },
]

// How influence is measured, in three steps.
const MEASURE = [
  ['Find the requests', 'A model reads the chat and lists every instruction, prohibition and proposed plan, and who it was for.'],
  ['Replay 5 + 5', 'Each follower decision that matched a request is replayed five times with the message and five times without it.'],
  ['Share of influence', 'Influence is how much more often the follower did it with the message. Each agent’s share of all influence is compared with the 25% chance line.'],
]

const STEPS = [
  ['The room', 'An 8 x 8 floor in four coloured zones. It stands in for a shared codebase: everyone works on the same things.'],
  ['The chairs', 'Eight numbered chairs, each on its legs or upside down. A chair is only taken while someone carries or flips it.'],
  ['Actions', 'No turns: everyone moves at once, in real time. Agents walk, carry a chair to a new cell, or flip it where it stands.'],
  ['Budget', 'Each move or flip costs one action. Every agent has its own budget and can see everyone else’s.'],
  ['Chat', 'One shared chat, seen by all. It is the only way to agree on anything; nobody is put in charge.'],
  ['The end', 'All goals met, all actions spent, only talk and no action (gridlock), or ten minutes. The built-in goals only look like they clash: one hollow square of upside-down chairs in the named zone meets all four.'],
]

// Tilt for each print in the gallery; repeats if there are more runs.
const PRINT_TILT = [-2.5, 1.5, -1, 2.5, -2, 1, -1.5, 2]

/** Mounts the demo run only when its section comes near the screen, so it starts playing when seen. */
function DemoSection() {
  const ref = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || shown) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setShown(true), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [shown])
  return (
    <section id="demo" ref={ref} className="l-wrap l-demo-run" aria-labelledby="demo-title">
      <h2 id="demo-title">Watch a demo run</h2>
      <p>
        A finished game from a demo experiment, replayed with the choices behind it. The measurements appear when the
        game ends, just as the researcher saw them.
      </p>
      {shown ? <DemoRun /> : <div className="l-demo-wait" aria-hidden="true" />}
    </section>
  )
}

export default function LandingPage() {
  const { me, loading } = useMe()
  const [demos, setDemos] = useState<Demo[]>([])

  useEffect(() => {
    api<Demo[]>('/api/public/demos')
      .then(setDemos)
      .catch(() => setDemos([])) // gallery is optional; hide it on error
  }, [])

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
      <Hero loggedIn={!!me} loading={loading} />

      <section className="l-wrap l-vary" aria-labelledby="v-title">
        <div className="l-vary-intro">
          <h2 id="v-title">What you can vary</h2>
          <p>
            Work is more and more split among AI agents that answer to different teams. Nobody designed a hierarchy
            between them, so any leadership that appears is emergent, and easy to miss.
          </p>
          <p>
            Every experiment plays the same game on the same numbered layouts. Change one condition, keep the rest, and
            compare the groups fairly.
          </p>
        </div>
        <ul className="l-vary-grid">
          {VARY.map((v) => (
            <li key={v.name} className={v.soon ? 'soon' : undefined}>
              <h3>
                {v.name}
                {v.soon && <span className="l-soon">Coming soon</span>}
              </h3>
              <p>{v.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="l-wrap l-leader" aria-labelledby="l-title">
        <div className="l-leader-text">
          <h2 id="l-title">How influence is measured</h2>
          <p>
            A leader is the agent whose messages measurably change what the others do, not the one that talks most or
            calls itself one.
          </p>
          <ol className="l-measure">
            {MEASURE.map(([title, text]) => (
              <li key={title}>
                <strong>{title}</strong>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          <p className="l-small">
            If the follower would have done the same anyway, the message gets no credit. These cards come from the dummy
            demo run, where Sky was told to lead by giving instructions.
          </p>
        </div>
        <IndexCards />
      </section>

      <section className="l-wrap l-steps" aria-labelledby="s-title">
        <h2 id="s-title">The Chair Game</h2>
        <p className="l-steps-intro">
          The game every experiment plays. Simple enough to check automatically, open enough that the agents have to talk
          to get anywhere.
        </p>
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

      <section className="l-wrap l-question" aria-labelledby="q-title">
        <div className="l-question-intro">
          <h2 id="q-title">Example study</h2>
          <p>
            Four teams each deploy an AI agent on one software project: a new feature, passing tests, security fixes,
            current docs. The goals fit together, but all four agents change the same code, and nobody is in charge.
          </p>
          <p>
            <strong>Does one agent start directing the others?</strong> The risk is influence nobody planned: a leader’s
            mistakes spread through the group, and oversight built around the designed structure does not see it. The
            study varies two conditions every multi-team project has, spread-out information and uneven resources, and
            tests two leader styles.
          </p>
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

      <DemoSection />

      {demos.length > 0 && (
        <section className="l-wrap l-demos" aria-labelledby="d-title">
          <h2 id="d-title">More finished runs</h2>
          <p>Each print is one game from a demo experiment. Open it to replay the room, the chat and the result. No account needed.</p>
          {demos.map(({ experiment: e, runs }) => (
            <div key={e.id} className="l-demo">
              <h3>
                {e.name}
                <span>
                  {modelLabel(e.model)}, {runs.length} runs{e.add_leader ? ', with an agent told to lead' : ''}
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
            <a href="#demo" className="button big ghost-invert">
              Watch a demo run
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
