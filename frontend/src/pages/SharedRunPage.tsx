import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'

const RunViewer = lazy(() => import('../run/RunViewer'))

export default function SharedRunPage() {
  const { token = '' } = useParams()
  return (
    <>
      <div className="muted" style={{ marginBottom: 12, fontSize: 14 }}>
        Shared run, read-only.
      </div>
      <Suspense fallback={<div className="muted">Loading viewer…</div>}>
        <RunViewer key={token} shareToken={token} />
      </Suspense>
    </>
  )
}
