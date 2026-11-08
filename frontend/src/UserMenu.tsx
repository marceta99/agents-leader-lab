import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api } from './api'
import { refreshMe, useMe } from './auth'

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  )
}

export default function UserMenu() {
  const { me, loading } = useMe()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => setOpen(false), [location.pathname])

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    await refreshMe()
    navigate('/')
  }

  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'navlink active' : 'navlink')

  return (
    <>
      <button
        className="menu-toggle ghost"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MenuIcon open={open} />
      </button>
      <nav className={open ? 'nav open' : 'nav'} aria-label="Main">
        {loading ? null : me ? (
          <>
            <NavLink to="/experiments" className={link}>
              Experiments
            </NavLink>
            <NavLink to="/settings/key" className={link}>
              API key
            </NavLink>
            {me.is_admin && (
              <NavLink to="/admin" className={link}>
                Admin
              </NavLink>
            )}
            <span className="who" title={me.email}>
              {me.email}
            </span>
            <button onClick={logout}>Log out</button>
          </>
        ) : (
          <>
            <NavLink to="/login" className={link}>
              Log in
            </NavLink>
            <NavLink to="/signup" className="button primary">
              Sign up
            </NavLink>
          </>
        )}
      </nav>
    </>
  )
}
