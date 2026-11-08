import { useId, useState, type ComponentProps, type ReactNode } from 'react'

export type FieldControl = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }

/** Visible label, helper text and an error tied to the control with aria-describedby. */
export default function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: (control: FieldControl) => ReactNode
}) {
  const id = useId()
  const describedBy = [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className={['field', error ? 'invalid' : '', className ?? ''].join(' ').trim()}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      <div aria-live="polite">
        {error && (
          <p id={`${id}-err`} className="field-error">
            {error}
          </p>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  )
}

/** Password input with a Show / Hide toggle. */
export function PasswordInput(props: ComponentProps<'input'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="password">
      <input {...props} type={shown ? 'text' : 'password'} />
      <button type="button" className="ghost" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
        {shown ? 'Hide' : 'Show'}
        <span className="sr-only"> password</span>
      </button>
    </div>
  )
}
