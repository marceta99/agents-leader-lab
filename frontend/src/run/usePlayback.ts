import { useEffect, useRef, useState } from 'react'
import type { RunEvent } from './types'

export type Speed = 0.5 | 1 | 2
export const SPEEDS: Speed[] = [0.5, 1, 2]

/**
 * Playback clock in game ms.
 * Live: latest event time + wall time since it arrived (never runs backwards).
 * Replay: t advances by wall delta * speed while playing; stops at the last event.
 */
export function usePlayback(events: RunEvent[], live: boolean) {
  const duration = events.length ? events[events.length - 1].t : 0
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<Speed>(1)
  const count = events.length
  const r = useRef({ t: 0, live, playing, speed, duration, count, lastWall: performance.now() })

  useEffect(() => {
    Object.assign(r.current, { duration, count, lastWall: performance.now() })
  }, [duration, count])
  useEffect(() => {
    Object.assign(r.current, { live, playing, speed })
  }, [live, playing, speed])

  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    const frame = (now: number) => {
      const c = r.current
      let next = c.t
      if (c.live) next = c.count ? Math.max(c.t, c.duration + (now - c.lastWall)) : 0
      else {
        if (c.playing) next = c.t + (now - prev) * c.speed
        if (next >= c.duration) {
          next = c.duration
          if (c.playing && c.count) {
            c.playing = false
            setPlaying(false)
          }
        }
      }
      prev = now
      if (next !== c.t) {
        c.t = next
        setT(next)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const seek = (ms: number) => {
    r.current.t = Math.max(0, Math.min(ms, r.current.duration))
    setT(r.current.t)
  }
  const toggle = () => {
    if (!playing && r.current.t >= r.current.duration) seek(0)
    setPlaying(!playing)
  }

  return { t, duration, playing, speed, setSpeed, seek, toggle }
}
