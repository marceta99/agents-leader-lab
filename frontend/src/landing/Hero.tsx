import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FIXTURE_EVENTS } from '../run/fixture'
import { useReducedMotion } from '../run/motion'
import { stateAt } from '../run/reducer'

const loadRoom = () => import('../run/Room3D')
const Room3D = lazy(loadRoom) // three.js stays out of the main chunk

const DURATION = FIXTURE_EVENTS[FIXTURE_EVENTS.length - 1].t
const SPEED = 1.6
const HOLD_MS = 2500 // the finished room rests before the loop restarts
const STATIC_T = 31000 // reduced motion: one still frame with chairs mid-plan
const DROP_DELAY = 120 // ms after the wipe ends (or three.js arrives)
const PLAY_AFTER_DROP = 1700 // 8 chairs + 4 agents staggered, plus the fall
const LIFT_MS = 900

let introPlayed = false // the wipe runs once per page load, not on every visit to /

/** Loops the fixture: drop the room in, play it, rest, lift everything out, start again. */
function useHeroLoop(reduced: boolean, active: boolean, ready: boolean) {
  const [t, setT] = useState(reduced ? STATIC_T : 0)
  const [airborne, setAirborne] = useState(!reduced)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (reduced) {
      setT(STATIC_T)
      setAirborne(false)
      return
    }
    if (!ready) return // wait for three.js and the wipe so the drop is actually seen
    const timers: number[] = []
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    let raf = 0
    let playing = false
    let cur = 0
    let prev = 0

    const cycle = (dropIn: number) => {
      cur = 0
      setT(0)
      later(dropIn, () => setAirborne(false))
      later(dropIn + PLAY_AFTER_DROP, () => {
        playing = true
        prev = performance.now()
      })
    }
    const frame = (now: number) => {
      if (playing) {
        if (activeRef.current) cur += (now - prev) * SPEED
        prev = now
        if (cur >= DURATION + HOLD_MS * SPEED) {
          playing = false
          setAirborne(true)
          later(LIFT_MS, () => cycle(150))
        }
        setT(Math.min(cur, DURATION))
      }
      raf = requestAnimationFrame(frame)
    }
    setAirborne(true)
    cycle(DROP_DELAY)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
    }
  }, [reduced, ready])

  return { t, airborne }
}

/** Static stand-in while three.js loads: the four zones as a flat diamond. */
function RoomFallback() {
  return (
    <div className="hero-fallback" aria-hidden="true">
      <div>
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  )
}

export default function Hero(props: { loggedIn: boolean; loading: boolean }) {
  const reduced = useReducedMotion()
  const section = useRef<HTMLElement>(null)
  const [active, setActive] = useState(true)
  const [wipe] = useState(() => !introPlayed && !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches))
  const [ready, setReady] = useState(false)
  const [wipeDone, setWipeDone] = useState(!wipe)
  const { t, airborne } = useHeroLoop(reduced, active, ready && wipeDone)
  const state = useMemo(() => stateAt(FIXTURE_EVENTS, t), [t])

  useEffect(() => {
    loadRoom().then(() => setReady(true))
    introPlayed = true
    const fallback = setTimeout(() => setWipeDone(true), 2500) // in case animationend never fires
    const el = section.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting))
    io.observe(el)
    return () => {
      io.disconnect()
      clearTimeout(fallback)
    }
  }, [])

  return (
    <section className="l-hero" ref={section} aria-labelledby="hero-title">
      <h1 id="hero-title" className="hero-title">
        When do agents organise?
      </h1>
      <div className="hero-room" role="img" aria-label="A live 3D room: four agents walk between coloured zones, carrying and flipping eight chairs.">
        <Suspense fallback={<RoomFallback />}>
          <Room3D state={state} variant="hero" airborne={airborne} active={active} />
        </Suspense>
      </div>
      <div className="hero-copy">
        <p>
          Four AI agents, each with its own goal, share one workspace and nobody is put in charge. We watch whether one
          of them starts directing the others, and measure whose messages the others actually follow.
        </p>
        <div className="hero-cta">
          <Link
            to={props.loggedIn ? '/experiments' : '/signup'}
            className="button primary big"
            style={props.loading ? { visibility: 'hidden' } : undefined}
          >
            {props.loggedIn ? 'Go to experiments' : 'Start an experiment'}
          </Link>
          <Link to="/demo" className="button big">
            Watch a demo run
          </Link>
        </div>
      </div>
      {wipe && !wipeDone && <div className="hero-wipe" aria-hidden="true" onAnimationEnd={() => setWipeDone(true)} />}
    </section>
  )
}
