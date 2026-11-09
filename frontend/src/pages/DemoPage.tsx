import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from '../api'
import { BackLink } from '../ui/Labels'
import { ViewerFallback } from './RunPage'

const RunViewer = lazy(() => import('../run/RunViewer'))

/** A random finished run from the demo experiments, replayed with its setup; the scripted run if there is none. */
export function DemoRun({ back = false }: { back?: boolean }) {
  const [runId, setRunId] = useState<number | 'fixture' | null>(null)

  const pick = (exclude?: number) =>
    api<{ run_id: number }>(`/api/public/demo-run${exclude ? `?exclude=${exclude}` : ''}`)
      .then((r) => setRunId(r.run_id))
      .catch(() => setRunId('fixture'))

  useEffect(() => {
    pick()
  }, [])

  return (
    <div className="demo-page">
      {(back || typeof runId === 'number') && (
        <div className="demo-bar">
          {back ? <BackLink to="/">Home</BackLink> : <span />}
          {typeof runId === 'number' && (
            <button type="button" className="compact" onClick={() => pick(runId)}>
              Watch another run
            </button>
          )}
        </div>
      )}
      <Suspense fallback={<ViewerFallback />}>
        {runId === null ? (
          <ViewerFallback />
        ) : runId === 'fixture' ? (
          <RunViewer fixture demo />
        ) : (
          <RunViewer key={runId} runId={runId} demo />
        )}
      </Suspense>
    </div>
  )
}

export default function DemoPage() {
  return <DemoRun back />
}
