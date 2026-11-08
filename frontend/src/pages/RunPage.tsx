import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'

const RunViewer = lazy(() => import('../run/RunViewer')) // keeps three.js out of the main chunk

// Reserves the viewer's height so nothing jumps when the chunk arrives.
export const ViewerFallback = () => (
  <div className="muted" style={{ minHeight: '70vh' }} aria-busy="true">
    Loading the viewer…
  </div>
)

export default function RunPage() {
  const { id } = useParams()
  const runId = Number(id)
  if (id !== 'demo' && !Number.isInteger(runId))
    return <div className="error">There is no run at this address. Open a run from its experiment page.</div>
  return (
    <Suspense fallback={<ViewerFallback />}>
      {id === 'demo' ? <RunViewer fixture /> : <RunViewer key={runId} runId={runId} />}
    </Suspense>
  )
}
