import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { refreshMe } from '../auth'
import { errorText } from '../format'
import AuthLayout from '../ui/AuthLayout'
import Field, { PasswordInput } from '../ui/Field'

export default function LoginPage() {
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/login', { json: { email, password } })
      await refreshMe()
      navigate(from ?? '/experiments')
    } catch (err) {
      const msg = errorText(err)
      setError(msg === 'Wrong email or password' ? 'Wrong email or password. Check both and try again.' : msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Back to the room."
      lede="Log in to launch experiments and read who led. Experiments keep running while you are away."
      facts={[
        'Your experiments are private.',
        'You pay Anthropic directly for every call.',
        'Forgot your password? Create a new account; there is no reset yet.',
      ]}
    >
      <h2>Log in</h2>
      <form className="stack-form" onSubmit={submit}>
        <Field label="Email">
          {(c) => (
            <input {...c} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label="Password" error={error}>
          {(c) => (
            <PasswordInput
              {...c}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <button className="primary block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="auth-switch">
        No account yet? <Link to="/signup">Sign up</Link>
      </p>
    </AuthLayout>
  )
}
