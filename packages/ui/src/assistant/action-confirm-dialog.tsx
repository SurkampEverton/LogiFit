'use client'

/**
 * `<ActionConfirmDialog>` — confirmação Camada 3 (ADR 0075).
 *
 * Renderizado quando LLM emite `proposeAction(...)`. Mostra título/descrição/
 * impacto + botões `[Confirmar] [Cancelar]`. Caller chama
 * `POST /api/ai/proposals/:id/confirm|reject`.
 *
 * Wrapper sobre `<ConfirmDialog>` (regra 45 + ADR 0089) — nunca paralelo.
 * Sprint 06: implementação inline pois `<ConfirmDialog>` ainda é stub.
 */
import { useState } from 'react'

export interface ActionConfirmDialogProps {
  proposalId: string
  title: string
  description: string
  impact?: string
  affectedEntities?: string[]
  /** Labels i18n flat. */
  labels: Record<string, string>
  onResult: (result: { confirmed: boolean; proposalId: string }) => void
}

export function ActionConfirmDialog({
  proposalId,
  title,
  description,
  impact,
  affectedEntities,
  labels,
  onResult,
}: ActionConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const label = (k: string) => labels[k] ?? k

  async function call(action: 'confirm' | 'reject') {
    setErr(null)
    setBusy(true)
    try {
      // safe-fetch-exempt: same-origin client fetch to local /api/* (regra 37 é pra outbound externo)
      const res = await fetch(`/api/ai/proposals/${proposalId}/${action}`, {
        method: 'POST',
      })
      const json = (await res.json()) as { ok: boolean; error?: { message: string } }
      if (!json.ok) {
        setErr(json.error?.message ?? 'Falha desconhecida')
        return
      }
      onResult({ confirmed: action === 'confirm', proposalId })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="action-confirm-title"
      aria-describedby="action-confirm-desc"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.4)',
        padding: 'var(--ev-space-4)',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: '100%',
          backgroundColor: 'var(--ev-surface)',
          borderRadius: 12,
          padding: 'var(--ev-space-5)',
          border: '1px solid var(--ev-border)',
        }}
      >
        <h3
          id="action-confirm-title"
          style={{
            margin: 0,
            fontSize: 'var(--ev-text-lg)',
            fontWeight: 700,
          }}
        >
          {title}
        </h3>
        <p
          id="action-confirm-desc"
          style={{
            margin: 'var(--ev-space-3) 0',
            fontSize: 'var(--ev-text-sm)',
            color: 'var(--ev-text)',
          }}
        >
          {description}
        </p>
        {impact && (
          <div
            style={{
              padding: 'var(--ev-space-3)',
              borderRadius: 8,
              backgroundColor: 'var(--ev-warning-bg, #fef3c7)',
              color: 'var(--ev-warning-text, #78350f)',
              fontSize: 'var(--ev-text-xs)',
              marginBottom: 'var(--ev-space-3)',
            }}
          >
            <strong>{label('assistant.confirm.impact')}:</strong> {impact}
          </div>
        )}
        {affectedEntities && affectedEntities.length > 0 && (
          <div style={{ marginBottom: 'var(--ev-space-3)' }}>
            <strong style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
              {label('assistant.confirm.affected')}:
            </strong>
            <ul
              style={{
                margin: 'var(--ev-space-1) 0 0',
                paddingLeft: 'var(--ev-space-4)',
                fontSize: 'var(--ev-text-xs)',
              }}
            >
              {affectedEntities.map((e, i) => (
                <li key={`${e}-${i}`}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {err && (
          <div
            role="alert"
            style={{
              padding: 'var(--ev-space-2)',
              borderRadius: 6,
              backgroundColor: 'var(--ev-danger-bg, #fee2e2)',
              color: 'var(--ev-danger-text, #991b1b)',
              fontSize: 'var(--ev-text-xs)',
              marginBottom: 'var(--ev-space-3)',
            }}
          >
            {err}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: 'var(--ev-space-2)',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={() => void call('reject')}
            disabled={busy}
            style={{
              minHeight: 'var(--ev-touch-min, 44px)',
              padding: 'var(--ev-space-2) var(--ev-space-4)',
              borderRadius: 8,
              border: '1px solid var(--ev-border)',
              backgroundColor: 'transparent',
              color: 'var(--ev-text)',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
              fontSize: 'var(--ev-text-sm)',
              fontWeight: 500,
            }}
          >
            {label('assistant.confirm.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void call('confirm')}
            disabled={busy}
            style={{
              minHeight: 'var(--ev-touch-min, 44px)',
              padding: 'var(--ev-space-2) var(--ev-space-4)',
              borderRadius: 8,
              border: 'none',
              backgroundColor: 'var(--ev-primary)',
              color: 'white',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
              fontSize: 'var(--ev-text-sm)',
              fontWeight: 600,
            }}
          >
            {label('assistant.confirm.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
