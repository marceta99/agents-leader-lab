import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { refreshMe, useMe } from '../auth'
import RequireAuth from '../RequireAuth'

function KeyPanel() {
  const { me } = useMe()
  const [replacing, setReplacing] = useState(false)
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/key', { method: 'PUT', json: { key } })
      setKey('')
      setReplacing(false)
      await refreshMe()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Delete your API key? Running experiments will stop.')) return
    setError('')
    try {
      await api('/api/key', { method: 'DELETE' })
      await refreshMe()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <h2>Anthropic API key</h2>
      <p className="muted">
        Your key is stored encrypted. We only show the last 4 characters. You pay Anthropic directly for every call.
      </p>
      {me?.has_key && !replacing ? (
        <div className="row">
          <code>sk-ant-…{me.key_last4}</code>
          <button onClick={() => setReplacing(true)}>Replace</button>
          <button className="danger" onClick={remove}>
            Delete key
          </button>
        </div>
      ) : (
        <form className="form" onSubmit={save}>
          <label>
            {me?.has_key ? 'New key' : 'Key'}
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <div className="row">
            <button className="primary" disabled={busy || !key.trim()}>
              {busy ? 'Checking key…' : 'Save'}
            </button>
            {replacing && (
              <button type="button" onClick={() => setReplacing(false)} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
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
