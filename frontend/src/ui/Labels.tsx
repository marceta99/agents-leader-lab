import { AGENT_COLORS, statusLabel } from '../format'

/** Status as text plus a shape, so it never relies on colour alone. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-mark" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  )
}

/** Agent name with its room colour. */
export function AgentName({ name }: { name: string }) {
  return (
    <span className="agent">
      <span className="dot" style={{ background: AGENT_COLORS[name] ?? 'var(--other)' }} aria-hidden="true" />
      {name}
    </span>
  )
}
