import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import Logo from './Logo'
import AdminPage from './pages/AdminPage'
import ExperimentPage from './pages/ExperimentPage'
import ExperimentsPage from './pages/ExperimentsPage'
import KeyPage from './pages/KeyPage'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import NewExperimentPage from './pages/NewExperimentPage'
import RunPage from './pages/RunPage'
import SharedRunPage from './pages/SharedRunPage'
import SignupPage from './pages/SignupPage'
import UserMenu from './UserMenu'

function Shell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Agents Leader Lab home">
          <Logo />
          <span>Agents Leader Lab</span>
        </Link>
        <UserMenu />
      </header>
      {/* the landing page runs edge to edge; app pages sit in the 1200px column */}
      <main className={pathname === '/' ? 'bleed' : undefined}>{children}</main>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/settings/key" element={<KeyPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
          <Route path="/experiments/new" element={<NewExperimentPage />} />
          <Route path="/experiments/:id" element={<ExperimentPage />} />
          <Route path="/runs/:id" element={<RunPage />} />
          <Route path="/r/:token" element={<SharedRunPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  )
}
