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
  return (
    <div className="panel run-timeline">
      <button className="primary" onClick={props.onToggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={duration}
        step={100}
        value={Math.min(t, duration)}
        onChange={(e) => props.onSeek(Number(e.target.value))}
        aria-label="Playback position"
      />
      <span className="run-time">
        {fmtTime(t)} / {fmtTime(duration)}
      </span>
      <div className="row run-speeds">
        {([1, 2, 4] as Speed[]).map((s) => (
          <button key={s} className={s === speed ? 'primary' : ''} onClick={() => props.onSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
    </div>
  )
}
