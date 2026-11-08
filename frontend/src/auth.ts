import { useEffect, useState } from 'react'
import { api, ApiError } from './api'

export type Me = { id: number; email: string; is_admin: boolean; has_key: boolean; key_last4: string | null }

// Module-level cache shared by every useMe() caller. undefined = not fetched yet, null = logged out.
let cached: Me | null | undefined
let inflight: Promise<Me | null> | null = null
const listeners = new Set<(me: Me | null) => void>()

function fetchMe(): Promise<Me | null> {
  inflight ??= api<Me>('/api/me')
    .catch((e) => {
      if (e instanceof ApiError && e.status === 401) return null
      throw e
    })
    .then((me) => {
      cached = me
      listeners.forEach((l) => l(me))
      return me
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Refetch /api/me and update every mounted useMe(). Call after login, logout, key changes. */
export function refreshMe(): Promise<Me | null> {
  return fetchMe()
}

export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(cached)
  useEffect(() => {
    listeners.add(setMe)
    if (cached === undefined) fetchMe().catch(() => setMe(null))
    return () => {
      listeners.delete(setMe)
    }
  }, [])
  return { me: me ?? null, loading: me === undefined, refresh: refreshMe }
}
