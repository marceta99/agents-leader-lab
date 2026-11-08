// Mark: a ring of eight chairs (the joint solution) with one filled seat for the agent who leads.
export default function Logo({ size = 28 }: { size?: number }) {
  const cells = [
    [0, 0], [1, 0], [2, 0],
    [0, 1], [2, 1],
    [0, 2], [1, 2], [2, 2],
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <rect x="0" y="0" width="30" height="30" rx="7" fill="var(--ink)" />
      {cells.map(([x, y], i) => (
        <rect
          key={i}
          x={5 + x * 7}
          y={5 + y * 7}
          width="5.5"
          height="5.5"
          rx="1.4"
          fill={i === 0 ? 'var(--z1)' : '#ffffff'}
          opacity={i === 0 ? 1 : 0.9}
        />
      ))}
    </svg>
  )
}
