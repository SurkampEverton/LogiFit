'use client'
import { useEffect, useId, useRef, useState } from 'react'

/**
 * PromptDialog — substitui `window.prompt()` (proibido pela regra 45 + ADR 0089).
 *
 * Mesma estratégia do `confirm()`: imperativo + componente listener.
 * `<PromptDialog>` é montado uma vez em `app/layout.tsx` (via `<MessageHost>`).
 *
 * @example
 *   const reason = await prompt({
 *     title: t('action.cancel_reason'),
 *     label: t('action.reason_label'),
 *     validator: (v) => v.length >= 10 ? null : t('errors.too_short'),
 *   })
 *   if (reason) await cancelGuide({ reason })
 */
export interface PromptOptions {
  title: string
  label: string
  initial?: string
  placeholder?: string
  validator?: (value: string) => string | null
  confirmLabel?: string
  cancelLabel?: string
}

interface PromptRequest {
  options: PromptOptions
  resolve: (value: string | null) => void
}

let currentListener: ((req: PromptRequest) => void) | null = null

export async function prompt(options: PromptOptions): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (!currentListener) {
    console.warn('[prompt] No host mounted — falling back to native dialog')
    // alert-exempt: fallback de último recurso (SSR/test/storybook); degrada graciosamente
    return window.prompt(options.title, options.initial)
  }
  return new Promise<string | null>((resolve) => {
    currentListener!({ options, resolve })
  })
}

export function PromptDialog(): React.ReactElement | null {
  const [request, setRequest] = useState<PromptRequest | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const titleId = useId()
  const labelId = useId()
  const errorId = useId()

  useEffect(() => {
    currentListener = (req) => {
      setValue(req.options.initial ?? '')
      setError(null)
      setRequest(req)
    }
    return () => {
      currentListener = null
    }
  }, [])

  useEffect(() => {
    if (request && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal()
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [request])

  if (!request) return null
  const { options, resolve } = request
  const confirmLabel = options.confirmLabel ?? 'Confirmar'
  const cancelLabel = options.cancelLabel ?? 'Cancelar'

  function cancel() {
    dialogRef.current?.close()
    resolve(null)
    setRequest(null)
  }

  function submit() {
    if (options.validator) {
      const err = options.validator(value)
      if (err) {
        setError(err)
        return
      }
    }
    dialogRef.current?.close()
    resolve(value)
    setRequest(null)
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      onClose={() => {
        // Browser ESC dispatches onClose — treat as cancel
        if (request) {
          resolve(null)
          setRequest(null)
        }
      }}
      style={{
        border: '1px solid var(--ev-border)',
        borderRadius: 'var(--ev-radius-md)',
        background: 'var(--ev-surface)',
        color: 'var(--ev-text)',
        padding: 0,
        maxWidth: '460px',
        width: '90vw',
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gap: 'var(--ev-space-md)',
        }}
      >
        <h2 id={titleId} style={{ margin: 0, fontSize: 'var(--ev-text-lg)' }}>
          {options.title}
        </h2>
        <div>
          <label
            id={labelId}
            htmlFor="ev-prompt-input"
            style={{
              display: 'block',
              fontSize: 'var(--ev-text-sm)',
              marginBottom: 'var(--ev-space-1)',
              color: 'var(--ev-text)',
            }}
          >
            {options.label}
          </label>
          <input
            ref={inputRef}
            id="ev-prompt-input"
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              if (error) setError(null)
            }}
            placeholder={options.placeholder}
            aria-labelledby={labelId}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : false}
            className="ev-input"
            style={{ width: '100%' }}
          />
          {error ? (
            <div
              id={errorId}
              role="alert"
              style={{
                marginTop: 'var(--ev-space-1)',
                fontSize: 'var(--ev-text-xs)',
                color: 'var(--ev-danger)',
              }}
            >
              {error}
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--ev-space-2)',
          }}
        >
          <button type="button" onClick={cancel} className="ev-btn ev-btn-ghost">
            {cancelLabel}
          </button>
          <button type="submit" className="ev-btn ev-btn-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
