import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { refreshMe, useMe } from '../auth'
import { errorText } from '../format'
import RequireAuth from '../RequireAuth'
import ConfirmButton from '../ui/ConfirmButton'
import Field, { PasswordInput } from '../ui/Field'
import './pages.css'

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys'

function KeyPanel() {
  const { me } = useMe()
  const [replacing, setReplacing] = useState(false)
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api('/api/key', { method: 'PUT', json: { key: key.trim() } })
      setKey('')
      setReplacing(false)
      await refreshMe()
      setNotice('Key saved. You can launch experiments now.')
    } catch (err) {
      const msg = errorText(err)
      setError(
        msg === 'Invalid key'
          ? 'Anthropic did not accept this key. Copy it again from the Anthropic console; it starts with sk-ant-.'
          : msg,
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setError('')
    setNotice('')
    try {
      await api('/api/key', { method: 'DELETE' })
      await refreshMe()
      setNotice('Key deleted. Add a new one to run experiments again.')
    } catch (err) {
      setError(errorText(err))
    }
  }

  const hasKey = !!me?.has_key

  return (
    <div className="app-page narrow">
      <header className="ph">
        <div>
          <h1>API key</h1>
          <p className="lede">
            Experiments call Claude with your own Anthropic key, so you stay in control of what they cost.
          </p>
        </div>
      </header>

      <div className="key-layout">
        <section className="panel key-sheet" aria-labelledby="key-title">
          <h2 id="key-title" className="sheet-title">
            {hasKey ? 'Your saved key' : 'Add your key'}
          </h2>

          {hasKey && !replacing ? (
            <>
              <p className="key-value tnum" aria-label={`Key ending in ${me?.key_last4}`}>
                sk-ant-…{me?.key_last4}
              </p>
              <p className="muted">Checked with Anthropic when it was saved.</p>
              <div className="actions">
                <button type="button" onClick={() => setReplacing(true)}>
                  Replace key
                </button>
                <ConfirmButton
                  label="Delete key"
                  question="Delete your key? Running experiments stop; finished runs are kept."
                  confirmLabel="Delete key"
                  busyLabel="Deleting…"
                  onConfirm={remove}
                />
              </div>
            </>
          ) : (
            <form className="stack-form" onSubmit={save}>
              <Field
                label={hasKey ? 'New key' : 'Anthropic API key'}
                hint={
                  <>
                    Starts with sk-ant-. Get one at{' '}
                    <a href={CONSOLE_URL} target="_blank" rel="noreferrer">
                      console.anthropic.com
                    </a>
                    .
                  </>
                }
                error={error}
              >
                {(c) => (
                  <PasswordInput
                    {...c}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-ant-…"
                    required
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                )}
              </Field>
              <div className="actions">
                <button className="primary" disabled={busy || !key.trim()}>
                  {busy ? 'Checking key with Anthropic…' : 'Save key'}
                </button>
                {replacing && (
                  <button type="button" onClick={() => setReplacing(false)} disabled={busy}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
          {error && hasKey && !replacing && <p className="form-error">{error}</p>}
          <p className="notice" role="status">
            {notice}
            {notice && hasKey && (
              <>
                {' '}
                <Link to="/experiments/new">New experiment</Link>
              </>
            )}
          </p>
        </section>

        <dl className="key-facts">
          <div>
            <dt>Stored encrypted</dt>
            <dd>The key is encrypted before it is saved and is only decrypted to call Claude for your runs.</dd>
          </div>
          <div>
            <dt>Only the last 4 characters are shown</dt>
            <dd>That is enough to tell which key you saved.</dd>
          </div>
          <div>
            <dt>You pay Anthropic directly</dt>
            <dd>Every call is billed to your Anthropic account. Each experiment has a spending cap.</dd>
          </div>
          <div>
            <dt>Checked when you save</dt>
            <dd>A tiny test call catches a wrong key straight away.</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

export default function KeyPage() {
  return (
    <RequireAuth>
      <KeyPanel />
    </RequireAuth>
  )
}
