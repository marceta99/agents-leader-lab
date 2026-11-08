import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { ViewerFallback } from './RunPage'

const RunViewer = lazy(() => import('../run/RunViewer'))

export default function SharedRunPage() {
  const { token = '' } = useParams()
  return (
    <>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 14 }}>
        Shared run. You can replay it, but not change it.
      </p>
      <Suspense fallback={<ViewerFallback />}>
        <RunViewer key={token} shareToken={token} />
      </Suspense>
    </>
  )
}
