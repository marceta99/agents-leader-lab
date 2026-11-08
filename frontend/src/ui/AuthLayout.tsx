import type { ReactNode } from 'react'
import '../pages/pages.css'

/** Split layout for log in / sign up: a display statement on one side, the form sheet on the other. */
export default function AuthLayout({
  title,
  lede,
  facts,
  children,
}: {
  title: string
  lede: string
  facts: string[]
  children: ReactNode
}) {
  return (
    <div className="auth">
      <div className="auth-statement">
        <ChairRing />
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
      </div>
      <div className="auth-form panel">{children}</div>
      <ul className="auth-facts">
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  )
}

/** The logo idea set large: eight chairs in a ring, one seat taken by whoever leads. */
function ChairRing() {
  const cells = [
    [0, 0], [1, 0], [2, 0],
    [0, 1], [2, 1],
    [0, 2], [1, 2], [2, 2],
  ]
  return (
    <svg className="chair-ring" viewBox="0 0 30 30" aria-hidden="true">
      <rect width="30" height="30" rx="5" fill="var(--ink)" />
      {cells.map(([x, y], i) => (
        <rect
          key={i}
          x={5 + x * 7}
          y={5 + y * 7}
          width="5.5"
          height="5.5"
          rx="1.2"
          fill={i === 0 ? 'var(--z1)' : '#fff'}
          opacity={i === 0 ? 1 : 0.92}
        />
      ))}
    </svg>
  )
}
