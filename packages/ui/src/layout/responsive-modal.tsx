'use client'

/**
 * `<ResponsiveModal>` — modal responsivo (regra 31 + ADR 0063).
 *
 * Mobile: bottom-sheet (full width, max-height 90vh, encostado no rodapé com
 *   safe-area-inset-bottom). Visual sugere "puxar pra baixo" (drag handle).
 * Desktop (≥640px): centered modal com max-width 520px (override via `maxWidth`).
 *
 * Usa `<dialog>` HTML5 nativo — mesmo padrão de `<ConfirmDialog>` /
 * `<PromptDialog>` — então herda focus trap, ESC, backdrop e a11y nativo.
 *
 * Controlado: caller decide `open` + `onOpenChange(false)`. Sem listener
 * imperativo como confirm/prompt — modal não é one-shot.
 *
 * @example
 *   <ResponsiveModal open={open} onOpenChange={setOpen} title={t('reagendar')}>
 *     <RescheduleForm onSuccess={() => setOpen(false)} />
 *   </ResponsiveModal>
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  /** Largura máxima em desktop (default 520px). */
  maxWidth?: number
  /** Esconde botão "X" de fechar (caller controla via children). */
  hideCloseButton?: boolean
}

export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  children,
  maxWidth = 520,
  hideCloseButton = false,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      onClose={() => onOpenChange(false)}
      onClick={(e) => {
        // backdrop click fecha (não conta clique dentro do form)
        if (e.target === dialogRef.current) onOpenChange(false)
      }}
      className="ev-responsive-modal"
      style={{
        border: '1px solid var(--ev-border)',
        background: 'var(--ev-surface)',
        color: 'var(--ev-text)',
        padding: 0,
        margin: 0,
        width: '100vw',
        maxWidth: `${maxWidth}px`,
      }}
    >
      <div
        style={{
          padding: 'var(--ev-space-md, 16px)',
          display: 'grid',
          gap: 'var(--ev-space-md, 16px)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--ev-space-2, 8px)',
          }}
        >
          <h2 id={titleId} style={{ margin: 0, fontSize: 'var(--ev-text-lg, 18px)' }}>
            {title}
          </h2>
          {!hideCloseButton && (
            <button
              type="button"
              aria-label="Fechar"
              onClick={() => onOpenChange(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--ev-text-muted)',
                cursor: 'pointer',
                minWidth: 'var(--ev-touch-min, 44px)',
                minHeight: 'var(--ev-touch-min, 44px)',
                fontSize: 'var(--ev-text-xl, 20px)',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </header>
        <div>{children}</div>
      </div>

      <style>{`
        .ev-responsive-modal {
          border-radius: var(--ev-radius-md, 8px);
        }
        /* Mobile: bottom-sheet */
        @media (max-width: 639px) {
          .ev-responsive-modal {
            margin: 0 auto;
            margin-top: auto !important;
            margin-bottom: 0 !important;
            width: 100vw;
            max-width: 100vw !important;
            border-radius: var(--ev-radius-lg, 12px) var(--ev-radius-lg, 12px) 0 0;
            border-bottom: none;
            padding-bottom: env(safe-area-inset-bottom);
            inset-block-end: 0;
            inset-block-start: auto;
          }
        }
        /* Desktop: centered */
        @media (min-width: 640px) {
          .ev-responsive-modal {
            margin: auto;
          }
        }
        /* Backdrop padrão Dialog */
        .ev-responsive-modal::backdrop {
          background: rgba(0, 0, 0, 0.4);
        }
      `}</style>
    </dialog>
  )
}
