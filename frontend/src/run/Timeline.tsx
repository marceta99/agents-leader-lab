import { fmtTime } from './reducer'
import type { Speed } from './usePlayback'

export default function Timeline(props: {
  t: number
  duration: number
  playing: boolean
  speed: Speed
  onToggle: () => void
  onSeek: (ms: number) => void
  onSpeed: (s: Speed) => void
}) {
  const { t, duration, playing, speed } = props
  const pct = duration ? (Math.min(t, duration) / duration) * 100 : 0
  return (
    <div className="rv-timeline">
      <button className="rv-play" onClick={props.onToggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <rect x="3" y="2" width="4" height="14" rx="1.5" fill="currentColor" />
            <rect x="11" y="2" width="4" height="14" rx="1.5" fill="currentColor" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M4 2.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 4 2.5Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <input
        type="range"
        min={0}
        max={duration}
        step={100}
        value={Math.min(t, duration)}
        onChange={(e) => props.onSeek(Number(e.target.value))}
        aria-label="Playback position"
        aria-valuetext={`${fmtTime(t)} of ${fmtTime(duration)}`}
        style={{ ['--p' as string]: `${pct}%` }}
      />
      <span className="rv-time tnum">
        {fmtTime(t)} <span className="rv-dim">/ {fmtTime(duration)}</span>
      </span>
      <div className="rv-speeds" role="group" aria-label="Playback speed">
        {([1, 2, 4] as Speed[]).map((s) => (
          <button key={s} className={s === speed ? 'on' : undefined} aria-pressed={s === speed} onClick={() => props.onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
    </div>
  )
}
