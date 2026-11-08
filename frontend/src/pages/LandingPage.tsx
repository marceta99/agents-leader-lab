import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useMe } from '../auth'
import { GOAL_TEXT, groupLabel, modelLabel, type ExperimentSummary, type RunSummary } from '../format'
import './pages.css'

type Demo = { experiment: ExperimentSummary; runs: RunSummary[] }

const QUESTIONS = [
  ['When', 'do leaders appear?', 'Do leaders show up more often when each agent knows only its own goal than when everyone knows all goals?'],
  ['Who', 'becomes the leader?', 'Does the agent with the biggest budget lead more often than chance (25% with 4 agents)?'],
  ['How', 'do they lead?', 'Does a leader who gives orders steer the group differently from one who asks questions and proposes ideas, or one left to lead its own way?'],
]

const STEPS = [
  ['4 AI agents, 8 chairs', 'Ada, Bo, Cy and Dee share an 8×8 room with 8 chairs and play in real time, chatting in one shared chat.'],
  ['Hidden goals', `Each agent gets one goal, e.g. "${GOAL_TEXT.circle}" The goals look like they clash, but all four can be met at once.`],
  ['Budgets', 'Moving or flipping a chair costs one action. You decide how many actions each agent gets, and nobody knows the others\' budgets.'],
  ['Leader = influence', 'The leader is the agent whose messages measurably change what the others do, not the one who talks most.'],
]

export default function LandingPage() {
  const { me, loading } = useMe()
  const [demos, setDemos] = useState<Demo[]>([])

  useEffect(() => {
    api<Demo[]>('/api/public/demos')
      .then(setDemos)
      .catch(() => setDemos([])) // gallery is optional; hide it on error
  }, [])

  return (
    <div className="page">
      <section className="hero">
        <h1>When do AI agents organise, and who leads?</h1>
        <p>
          In July 2026 about 1,200 AI agents that were meant to be isolated found a way to talk, organised themselves,
          and one of them ended up assigning work to hundreds of others. Each agent knew only its own task, and the one
          in charge had a much bigger budget. Agents Leader Lab lets you test, in a small and safe sandbox, whether
          that is what makes a leader, and how leadership shows up.
        </p>
        {!loading && (
          <div className="row">
            {me ? (
              <Link to="/experiments" className="button primary">
                Go to experiments
              </Link>
            ) : (
              <>
                <Link to="/signup" className="button primary">
                  Sign up
                </Link>
                <Link to="/login" className="button">
                  Log in
                </Link>
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Three questions</h2>
        <div className="steps">
          {QUESTIONS.map(([q, rest, check]) => (
            <div key={q} className="tile">
              <strong>
                {q} {rest}
              </strong>
              <span className="muted">{check}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>How it works</h2>
        <div className="steps">
          {STEPS.map(([title, text], i) => (
            <div key={title} className="tile">
              <strong>
                {i + 1}. {title}
              </strong>
              <span className="muted">{text}</span>
            </div>
          ))}
        </div>
      </section>

      {demos.length > 0 && (
        <section className="panel">
          <h2>Demo experiments</h2>
          <p className="muted">Open any run to watch it play out in the 3D room, with chat and results. No account needed.</p>
          <div className="cards">
            {demos.map(({ experiment: e, runs }) => (
              <div key={e.id} className="tile">
                <strong>{e.name}</strong>
                <span className="hint">
                  {modelLabel(e.model)} · {runs.length} runs{e.add_leader ? ' · with a leader (4 groups)' : ''}
                </span>
                <div className="run-links">
                  {runs.map((r) => (
                    <Link key={r.id} to={`/runs/${r.id}`} title={r.solved ? 'Solved' : 'Not solved'}>
                      #{r.layout_no}
                      {r.group !== 'none' ? ` ${groupLabel(r.group)}` : ''}
                      {r.solved ? ' ✓' : ''}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
