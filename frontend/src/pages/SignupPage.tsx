import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { refreshMe } from '../auth'
import { errorText } from '../format'
import AuthLayout from '../ui/AuthLayout'
import Field, { PasswordInput } from '../ui/Field'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function SignupPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState({ email: false, password: false })
  const [emailTaken, setEmailTaken] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const emailError = EMAIL_RE.test(email.trim()) ? '' : 'Enter an email address like name@example.com.'
  const passwordError =
    password.length >= 8 ? '' : `Use at least 8 characters${password ? ` (you have ${password.length})` : ''}.`

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched({ email: true, password: true })
    if (emailError) return emailRef.current?.focus()
    if (passwordError) return passwordRef.current?.focus()
    setBusy(true)
    setError('')
    setEmailTaken(false)
    try {
      await api('/api/auth/signup', { json: { email: email.trim(), password } })
      await refreshMe()
      navigate('/settings/key')
    } catch (err) {
      const msg = errorText(err)
      if (msg.includes('already exists')) setEmailTaken(true)
      else setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const emailMessage = emailTaken ? (
    <>
      An account with this email already exists. <Link to="/login">Log in</Link> instead.
    </>
  ) : touched.email ? (
    emailError
  ) : (
    ''
  )

  return (
    <AuthLayout
      title="Four agents. One room. Who leads?"
      lede="Create an account, add your Anthropic API key, and run the chairs game as often as you like."
      facts={['No invite or email check.', 'You pay Anthropic directly for every call.', 'Your experiments are private.']}
    >
      <h2>Sign up</h2>
      <form className="stack-form" onSubmit={submit} noValidate>
        <Field label="Email" error={emailMessage}>
          {(c) => (
            <input
              {...c}
              ref={emailRef}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setEmailTaken(false)
              }}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={touched.password && passwordError ? undefined : 'At least 8 characters.'}
          error={touched.password ? passwordError : ''}
        >
          {(c) => (
            <PasswordInput
              {...c}
              ref={passwordRef}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            />
          )}
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </AuthLayout>
  )
}
