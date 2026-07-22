'use client'

/**
 * Ações inline do detalhe de emissão — Sprint 36b.2 (ADR 0059).
 *
 * Cancelar + CC-e são alto risco fiscal (regra 43): o gate de MFA recente é
 * server-side no wrapper; aqui só coletamos justificativa/correção via dialog
 * (regra 45 — sem window.prompt). Retry só aparece em rejected com
 * retry_count<3; re-consulta exige providerRef.
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  cancelEmission,
  issueCce,
  queryEmissionStatus,
  registerPortalCancellation,
  retryEmission,
} from '../actions'

type DialogKind = 'cancel' | 'cce' | null

export function EmissionActions({
  emissionId,
  status,
  kind,
  cancelWindowOpen,
  webserviceCancel,
  cancelWarning,
  canRetry,
  hasProviderRef,
}: {
  emissionId: string
  status: string
  kind: string
  cancelWindowOpen: boolean
  /** Município cancela por webservice? Quando false, o botão vira baixa manual. */
  webserviceCancel: boolean
  /** Aviso exibido no diálogo quando o cancelamento é só pelo portal. */
  cancelWarning: string | null
  canRetry: boolean
  hasProviderRef: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'cancel' | 'cce' | 'retry' | 'query' | null>(null)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [dialogText, setDialogText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const isCce = dialog === 'cce'
  const minLen = 15
  const canIssueCce = status === 'completed' && kind !== 'nfse' && kind !== 'nfce'

  async function run<T>(
    key: 'cancel' | 'cce' | 'retry' | 'query',
    fn: () => Promise<{ ok: boolean; data?: T; error?: { message?: unknown } }>,
    onOk?: (data: T) => void,
  ) {
    setPending(key)
    setError(null)
    setInfo(null)
    try {
      const r = await fn()
      if (!r.ok) throw new Error(String(r.error?.message ?? 'Erro'))
      onOk?.(r.data as T)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro inesperado')
    } finally {
      setPending(null)
    }
  }

  function submitDialog() {
    if (dialogText.trim().length < minLen) return
    const text = dialogText.trim()
    setDialog(null)
    setDialogText('')
    if (isCce) {
      void run(
        'cce',
        () => issueCce({ emissionId, correction: text }),
        () => setInfo('Carta de correção enviada.'),
      )
    } else if (webserviceCancel) {
      void run(
        'cancel',
        () => cancelEmission({ emissionId, justification: text }),
        () => setInfo('Cancelamento enviado ao provider.'),
      )
    } else {
      void run(
        'cancel',
        () => registerPortalCancellation({ emissionId, justification: text }),
        () => setInfo('Cancelamento registrado. A baixa na prefeitura é feita no portal.'),
      )
    }
  }

  return (
    <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
      <h2 style={{ marginTop: 0 }}>Ações</h2>
      <div className="flex flex-wrap items-center gap-2">
        {cancelWindowOpen && (
          <button
            type="button"
            className="ev-btn"
            disabled={pending !== null}
            onClick={() => {
              setDialog('cancel')
              setDialogText('')
            }}
          >
            {pending === 'cancel'
              ? 'Processando…'
              : webserviceCancel
                ? '🚫 Cancelar emissão'
                : '🚫 Registrar cancelamento'}
          </button>
        )}
        {canIssueCce && (
          <button
            type="button"
            className="ev-btn"
            disabled={pending !== null}
            onClick={() => {
              setDialog('cce')
              setDialogText('')
            }}
          >
            {pending === 'cce' ? 'Enviando…' : '✏️ Carta de correção'}
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            className="ev-btn ev-btn-primary"
            disabled={pending !== null}
            onClick={() =>
              void run(
                'retry',
                () => retryEmission({ emissionId }),
                () => setInfo('Reenvio disparado.'),
              )
            }
          >
            {pending === 'retry' ? 'Reenviando…' : '↻ Tentar novamente'}
          </button>
        )}
        {hasProviderRef && (
          <button
            type="button"
            className="ev-btn ev-btn-ghost"
            disabled={pending !== null}
            onClick={() =>
              void run(
                'query',
                () => queryEmissionStatus({ emissionId }),
                () => setInfo('Status re-consultado no provider.'),
              )
            }
          >
            {pending === 'query' ? 'Consultando…' : '🔄 Re-consultar status'}
          </button>
        )}
        {!cancelWindowOpen && !canIssueCce && !canRetry && !hasProviderRef && (
          <p style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
            Nenhuma ação disponível pra este status.
          </p>
        )}
      </div>

      {info && (
        <p className="text-sm" style={{ marginTop: '0.5rem' }}>
          {info}
        </p>
      )}
      {error && (
        <p
          className="text-xs"
          role="alert"
          style={{ marginTop: '0.5rem', color: 'var(--ev-danger, #dc2626)' }}
        >
          {error}
        </p>
      )}

      {/* Prompt dialog (regra 45 — sem window.prompt) */}
      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          role="alertdialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-md border p-5 space-y-3"
            style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
          >
            <h3 className="text-lg font-semibold" style={{ margin: 0 }}>
              {isCce
                ? 'Carta de Correção Eletrônica'
                : webserviceCancel
                  ? 'Cancelar emissão fiscal'
                  : 'Registrar cancelamento feito no portal'}
            </h3>
            {!isCce && !webserviceCancel && cancelWarning && (
              <p
                className="text-sm"
                role="note"
                style={{
                  margin: 0,
                  padding: 'var(--ev-space-sm)',
                  borderLeft: '3px solid var(--ev-warning, #92400e)',
                  background: 'var(--ev-warning-bg, #fef3c7)',
                  color: 'var(--ev-warning, #92400e)',
                }}
              >
                {cancelWarning}
              </p>
            )}
            <p className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
              {isCce
                ? 'Descreva a correção (campos não-fiscais: endereço, transportadora). Mínimo 15 caracteres; até 30 CC-e por chave.'
                : webserviceCancel
                  ? 'Informe a justificativa do cancelamento (mínimo 15 caracteres). Ação de alto risco — exige MFA recente.'
                  : 'Informe a referência do cancelamento feito no portal (protocolo, data ou motivo — mínimo 15 caracteres). Ação de alto risco — exige MFA recente.'}
            </p>
            <textarea
              className="ev-input w-full"
              rows={3}
              value={dialogText}
              onChange={(e) => setDialogText(e.target.value)}
              // biome-ignore lint/a11y/noAutofocus: dialog recém-aberto, foco no campo é o esperado
              autoFocus
            />
            <p className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
              {dialogText.trim().length}/{minLen} caracteres mínimos
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="ev-btn" onClick={() => setDialog(null)}>
                Voltar
              </button>
              <button
                type="button"
                className="ev-btn ev-btn-primary"
                disabled={dialogText.trim().length < minLen}
                onClick={submitDialog}
              >
                {isCce
                  ? 'Enviar CC-e'
                  : webserviceCancel
                    ? 'Confirmar cancelamento'
                    : 'Registrar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
