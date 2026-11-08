import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'

const RunViewer = lazy(() => import('../run/RunViewer')) // keeps three.js out of the main chunk

export default function RunPage() {
  const { id } = useParams()
  const runId = Number(id)
  if (id !== 'demo' && !Number.isInteger(runId)) return <div className="error">Unknown run.</div>
  return (
    <Suspense fallback={<div className="muted">Loading viewer…</div>}>
      {id === 'demo' ? <RunViewer fixture /> : <RunViewer key={runId} runId={runId} />}
    </Suspense>
  )
}
