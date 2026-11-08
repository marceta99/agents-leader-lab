import { Link, useNavigate } from 'react-router-dom'
import { api } from './api'
import { refreshMe, useMe } from './auth'

export default function UserMenu() {
  const { me, loading } = useMe()
  const navigate = useNavigate()
  if (loading) return null

  if (!me)
    return (
      <nav className="row">
        <Link to="/login">Log in</Link>
        <Link to="/signup" className="button primary">
          Sign up
        </Link>
      </nav>
    )

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    await refreshMe()
    navigate('/')
  }

  return (
    <nav className="row">
      <Link to="/experiments">Experiments</Link>
      <Link to="/settings/key">API key</Link>
      {me.is_admin && <Link to="/admin">Admin</Link>}
      <span className="muted">{me.email}</span>
      <button onClick={logout}>Log out</button>
    </nav>
  )
}
