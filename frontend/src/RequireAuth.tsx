import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useMe } from './auth'

/** Renders children only when logged in; otherwise redirects to /login (and back after login). */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useMe()
  const location = useLocation()
  if (loading) return <p className="muted">Loading…</p>
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}
