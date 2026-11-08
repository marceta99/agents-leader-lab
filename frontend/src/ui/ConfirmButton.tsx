import { useEffect, useRef, useState } from 'react'

/** A destructive button that asks inline before acting. Escape or Cancel backs out and returns focus. */
export default function ConfirmButton({
  label,
  question,
  confirmLabel,
  busyLabel,
  onConfirm,
}: {
  label: string
  question: string
  confirmLabel: string
  busyLabel: string
  onConfirm: () => Promise<unknown>
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const wasAsking = useRef(false)

  useEffect(() => {
    if (wasAsking.current && !asking) trigger.current?.focus()
    wasAsking.current = asking
  }, [asking])

  if (!asking)
    return (
      <button ref={trigger} type="button" className="danger" onClick={() => setAsking(true)}>
        {label}
      </button>
    )

  async function go() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
      setAsking(false)
    }
  }

  return (
    <div
      className="confirm"
      role="group"
      aria-label={question}
      onKeyDown={(e) => e.key === 'Escape' && !busy && setAsking(false)}
    >
      <p>{question}</p>
      <div className="row">
        <button type="button" className="danger-solid" disabled={busy} onClick={go}>
          {busy ? busyLabel : confirmLabel}
        </button>
        <button type="button" autoFocus disabled={busy} onClick={() => setAsking(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
