'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * ConfirmDialog — substitui `window.confirm()` (proibido pela regra 45 + ADR 0089).
 *
 * **Padrão imperativo + componente listener:**
 *   - Função `confirm(opts)` retorna `Promise<boolean>` — pode chamar de
 *     qualquer client component.
 *   - Componente `<ConfirmDialog>` monta em `app/layout.tsx` (uma vez) e
 *     escuta requisições via module-level listener; renderiza `<dialog>`
 *     HTML5 nativo com tokens EV + a11y nativo (focus trap + ESC + backdrop).
 *
 * **Fallback gracioso**: se nenhum `<ConfirmDialog>` montado, log warning +
 *   `window.confirm()` nativo (SSR/test/storybook envs).
 *
 * @example
 *   const ok = await confirm({
 *     title: t('action.delete_title'),
 *     body: t('action.delete_body'),
 *     danger: true,
 *   })
 *   if (ok) await deleteItem()
 */
export interface ConfirmOptions {
  title: string
  body: ReactNode
  danger?: boolean
  confirmLabel?: string
  cancelLabel?: string
}

interface ConfirmRequest {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

let currentListener: ((req: ConfirmRequest) => void) | null = null

export async function confirm(options: ConfirmOptions): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!currentListener) {
    console.warn('[confirm] No host mounted — falling back to native dialog')
    // alert-exempt: fallback de último recurso (SSR/test/storybook); degrada graciosamente
    return window.confirm(options.title)
  }
  return new Promise<boolean>((resolve) => {
    currentListener!({ options, resolve })
  })
}

export function ConfirmDialog(): React.ReactElement | null {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    currentListener = (req) => setRequest(req)
    return () => {
      currentListener = null
    }
  }, [])

  useEffect(() => {
    if (request && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal()
    }
  }, [request])

  if (!request) return null

  const { options, resolve } = request
  const confirmLabel = options.confirmLabel ?? 'Confirmar'
  const cancelLabel = options.cancelLabel ?? 'Cancelar'

  function handle(result: boolean) {
    dialogRef.current?.close()
    resolve(result)
    setRequest(null)
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      onClose={() => handle(false)}
      style={{
        border: '1px solid var(--ev-border)',
        borderRadius: 'var(--ev-radius-md)',
        background: 'var(--ev-surface)',
        color: 'var(--ev-text)',
        padding: 0,
        maxWidth: '420px',
        width: '90vw',
      }}
    >
      <form
        method="dialog"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gap: 'var(--ev-space-md)',
        }}
      >
        <h2 id={titleId} style={{ margin: 0, fontSize: 'var(--ev-text-lg)' }}>
          {options.title}
        </h2>
        <div style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
          {options.body}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--ev-space-2)',
          }}
        >
          <button
            type="button"
            onClick={() => handle(false)}
            className="ev-btn ev-btn-ghost"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => handle(true)}
            className={options.danger ? 'ev-btn ev-btn-danger' : 'ev-btn ev-btn-primary'}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
