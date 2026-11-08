import { percent } from '../format'

/** Slim progress meter. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const p = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="meter-fill" style={{ transform: `scaleX(${p})` }} />
    </div>
  )
}

/** A 0..1 rate on a 0–100% track, with the 25% chance line marked and labelled. */
export function ChanceBar({ rate, label, axis = false }: { rate: number | null; label: string; axis?: boolean }) {
  const p = Math.max(0, Math.min(1, rate ?? 0))
  return (
    <div className={axis ? 'chance with-axis' : 'chance'} role="img" aria-label={`${label}: ${percent(rate)}. Chance would be 25%.`}>
      <div className="chance-track">
        <div className="chance-fill" style={{ width: `${p * 100}%` }} />
        <div className="chance-line" aria-hidden="true">
          <span>25% chance</span>
        </div>
      </div>
      {axis && (
        <div className="chance-axis" aria-hidden="true">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      )}
    </div>
  )
}

export type StyleMixData = { directive: number; non_directive: number; other: number }

const STYLE_PARTS = [
  ['directive', 'Directive', 'var(--directive)'],
  ['non_directive', 'Non-directive', 'var(--non-directive)'],
  ['other', 'Other', 'var(--other)'],
] as const

/** Stacked bar of message styles with a text legend. */
export function StyleMix({ mix }: { mix: StyleMixData }) {
  const total = mix.directive + mix.non_directive + mix.other
  if (!total) return <p className="muted small-text">No messages to label.</p>
  const summary = STYLE_PARTS.map(([k, name]) => `${name} ${percent(mix[k] / total)}`).join(', ')
  return (
    <div className="style-mix">
      <div className="style-bar" role="img" aria-label={`Message styles: ${summary}`}>
        {STYLE_PARTS.map(([k, name, color]) =>
          mix[k] ? <div key={k} title={`${name}: ${mix[k]} messages`} style={{ flexGrow: mix[k], background: color }} /> : null,
        )}
      </div>
      <ul className="legend" aria-hidden="true">
        {STYLE_PARTS.map(([k, name, color]) => (
          <li key={k}>
            <span className="swatch" style={{ background: color }} />
            {name} <strong className="tnum">{percent(mix[k] / total)}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}
