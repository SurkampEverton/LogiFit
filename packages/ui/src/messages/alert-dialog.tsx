'use client'
import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * AlertDialog — substitui `window.alert()` (proibido pela regra 45 + ADR 0089).
 *
 * Diferente de `<ConfirmDialog>`/`<PromptDialog>` (imperativos): este é um
 * componente declarativo controlado pelo caller via `open` prop. Use quando
 * o estado do dialog faz parte do componente (ex: erro estático pós-submit).
 * Pra fluxo imperativo (await), use `toast.error()` ou `confirm()` se houver
 * decisão a tomar.
 *
 * a11y: `role="alertdialog"` + `aria-modal="true"` + focus trap nativo via
 * `<dialog>` HTML5 + tokens EV.
 */
export interface AlertDialogProps {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel?: string
  onClose: () => void
}

export function AlertDialog({
  open,
  title,
  body,
  confirmLabel = 'OK',
  onClose,
}: AlertDialogProps): React.ReactElement {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      onClose={onClose}
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
          {title}
        </h2>
        <div style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
          {body}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className="ev-btn ev-btn-primary" autoFocus>
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
