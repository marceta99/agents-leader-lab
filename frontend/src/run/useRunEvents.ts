import { useEffect, useState } from 'react'
import { api, wsUrl } from '../api'
import { FIXTURE_EVENTS, FIXTURE_RUN } from './fixture'
import type { RunEvent, RunInfo } from './types'

export const isLiveStatus = (status: string | undefined) => status === 'queued' || status === 'running'

/**
 * Loads a run's info + events. Live runs (queued/running) stream over the WebSocket, reconnecting with
 * `?after=<lastSeq>` and dropping duplicate seqs; finished runs fetch `/events` once.
 */
export function useRunEvents(opts: { runId?: number; shareToken?: string; fixture?: boolean }) {
  const { runId, shareToken, fixture } = opts
  const [run, setRun] = useState<RunInfo | null>(fixture ? FIXTURE_RUN : null)
  const [events, setEvents] = useState<RunEvent[]>(fixture ? FIXTURE_EVENTS : [])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (fixture) return
    const base = shareToken ? `/api/public/runs/${encodeURIComponent(shareToken)}` : `/api/runs/${runId}`
    const wsPath = shareToken ? `/ws/public/${encodeURIComponent(shareToken)}` : `/ws/runs/${runId}`
    let cancelled = false
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let lastSeq = 0
    let ended = false
    let buffer: RunEvent[] = []
    let flushQueued = false

    setRun(null)
    setEvents([])
    setError(null)

    // Batch bursts (the snapshot on connect) into one state update.
    const add = (incoming: RunEvent[]) => {
      for (const e of incoming) {
        if (typeof e?.seq !== 'number' || e.seq <= lastSeq) continue // duplicate or not an event
        lastSeq = e.seq
        buffer.push(e)
        if (e.type === 'run_ended') ended = true
      }
      if (!buffer.length || flushQueued) return
      flushQueued = true
      setTimeout(() => {
        flushQueued = false
        if (cancelled) return
        const batch = buffer
        buffer = []
        setEvents((prev) => prev.concat(batch))
      }, 50)
    }

    const refreshInfo = () =>
      api<RunInfo>(base)
        .then((info) => !cancelled && setRun(info))
        .catch(() => {})

    const connect = () => {
      if (cancelled) return
      ws = new WebSocket(wsUrl(`${wsPath}?after=${lastSeq}`))
      ws.onmessage = (m) => {
        try {
          const data = JSON.parse(m.data)
          add(Array.isArray(data) ? data : [data])
        } catch {
          /* ignore non-JSON frames */
        }
      }
      ws.onclose = () => {
        ws = null
        if (cancelled) return
        if (ended) refreshInfo()
        else retry = setTimeout(connect, 2000)
      }
    }

    api<RunInfo>(base)
      .then(async (info) => {
        if (cancelled) return
        setRun(info)
        if (isLiveStatus(info.status)) connect()
        else add((await api<RunEvent[]>(`${base}/events`)).sort((a, b) => a.seq - b.seq))
      })
      .catch((e: Error) => !cancelled && setError(e.message))

    return () => {
      cancelled = true
      clearTimeout(retry)
      ws?.close()
    }
  }, [runId, shareToken, fixture])

  return { run, events, error }
}
