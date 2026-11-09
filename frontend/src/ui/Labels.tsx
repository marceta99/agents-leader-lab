import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
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

/** The way back to the parent page, always in the same top-left spot. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="back-link">
      <span className="back-arrow" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16">
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>{children}</span>
    </Link>
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
