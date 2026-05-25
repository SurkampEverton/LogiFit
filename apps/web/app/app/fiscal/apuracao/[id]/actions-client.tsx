'use client'

/**
 * Client component pra actions inline na página de detalhe da apuração.
 * Sprint 37a: regenerar (rejeita se closed) + fechar (ConfirmDialog irreversível).
 * Sprint 37b adiciona PDF export.
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { closeAggregation, regenerateAggregation } from '../actions'

export function ApuracaoActions({
  aggregationId,
  isClosed,
  yearMonth,
}: {
  aggregationId: string
  isClosed: boolean
  yearMonth: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'regenerate' | 'close' | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRegenerate() {
    if (isClosed) return
    setPending('regenerate')
    setError(null)
    try {
      const r = await regenerateAggregation({ id: aggregationId })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao regenerar')
    } finally {
      setPending(null)
    }
  }

  async function handleClose() {
    if (isClosed) return
    setPending('close')
    setError(null)
    try {
      const r = await closeAggregation({ id: aggregationId })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      setConfirmClose(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao fechar')
    } finally {
      setPending(null)
    }
  }

  if (isClosed) {
    return (
      <p className="text-xs italic" style={{ color: 'var(--ev-text-muted)' }}>
        Apuração fechada — não pode ser alterada. Reabertura via super_admin (Sprint 37c+).
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleRegenerate}
        disabled={pending !== null}
        className="ev-btn"
        style={{ fontSize: '0.85rem' }}
      >
        {pending === 'regenerate' ? 'Recalculando…' : '↻ Regenerar cálculo'}
      </button>
      <button
        type="button"
        onClick={() => setConfirmClose(true)}
        disabled={pending !== null}
        className="ev-btn ev-btn-primary"
        style={{ fontSize: '0.85rem' }}
      >
        Fechar apuração
      </button>
      {error && (
        <span className="text-xs" style={{ color: 'var(--ev-danger, #dc2626)' }}>
          {error}
        </span>
      )}

      {/* Confirm dialog (regra 45 — sem window.confirm) */}
      {confirmClose && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          role="alertdialog"
          aria-modal="true"
        >
          <div
            className="max-w-md rounded-md border p-5 space-y-3"
            style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
          >
            <h3 className="text-lg font-semibold">Fechar apuração {yearMonth}?</h3>
            <p className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
              Apurações fechadas são <strong>imutáveis</strong>. Após confirmar você não poderá:
            </p>
            <ul
              className="text-sm list-disc list-inside space-y-1"
              style={{ color: 'var(--ev-text-muted)' }}
            >
              <li>Regenerar este cálculo</li>
              <li>Editar receita ou alíquota</li>
              <li>Modificar o memorial</li>
            </ul>
            <p className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
              Reabertura via super_admin fica pra Sprint 37c+. Tem certeza?
            </p>
            {error && (
              <p className="text-xs" style={{ color: 'var(--ev-danger, #dc2626)' }}>
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmClose(false)}
                disabled={pending !== null}
                className="ev-btn"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={pending !== null}
                className="ev-btn ev-btn-primary"
              >
                {pending === 'close' ? 'Fechando…' : 'Confirmar fechamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
