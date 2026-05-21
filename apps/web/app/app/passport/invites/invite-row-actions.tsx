'use client'

/**
 * Client island com ações por row da lista de invites (Sprint 02b9+).
 *
 * Ações disponíveis por status do invite:
 *   - `pending`: Copiar link · WhatsApp share · Revogar (ConfirmDialog)
 *   - `active`:  Revogar vínculo (PromptDialog pra motivo)
 *   - `revoked`: nenhuma ação inline (read-only)
 *
 * Server Actions reusadas:
 *   - `cancelPatientInvite({ linkId })`  — pending → revoked com reason
 *     interno `cancelled_by_staff`
 *   - `revokePatientLink({ linkId, reason })` — active → revoked + cascade
 *     deactivate em `patient_link_modules`
 *
 * **UX:**
 *   - `confirm()` / `prompt()` do catálogo (regra 45 + ADR 0089)
 *   - `toast.success` + `toast.fromApiError` (regra 45)
 *   - `router.refresh()` pós-sucesso pra recarregar SSR e reduzir contagem
 *     `pending`/`active` no breadcrumb da página
 *
 * **Fallback clipboard:** se navigator.clipboard indisponível, expõe input
 * read-only com seleção automática (não usa `window.prompt`, regra 45).
 */
import { confirm, prompt, toast } from '@repo/ui/messages'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { cancelPatientInvite, revokePatientLink } from '../actions'

interface Props {
  inviteId: string
  status: 'pending' | 'active' | 'revoked'
  inviteUrl: string
  whatsappShareUrl: string | null
  patientName: string
  compact?: boolean
}

type CopyState = 'idle' | 'copied' | 'manual'

export function InviteRowActions({
  inviteId,
  status,
  inviteUrl,
  whatsappShareUrl,
  patientName,
  compact = false,
}: Props) {
  const router = useRouter()
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [revoking, setRevoking] = useState(false)
  const fallbackInputRef = useRef<HTMLInputElement>(null)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      // Clipboard API unavailable (insecure context / permission denied) —
      // degrade gracefully: expor input read-only abaixo pro user selecionar
      // manualmente. Sem window.prompt (regra 45).
      setCopyState('manual')
      setTimeout(() => fallbackInputRef.current?.select(), 0)
    }
  }

  async function handleCancelPending() {
    const ok = await confirm({
      title: 'Cancelar convite',
      body: `O convite enviado para ${patientName} será marcado como revogado. O paciente perde o link de aceite. Confirmar?`,
      danger: true,
      confirmLabel: 'Cancelar convite',
      cancelLabel: 'Voltar',
    })
    if (!ok) return

    setRevoking(true)
    const result = await cancelPatientInvite({ linkId: inviteId })
    setRevoking(false)
    if (!result.ok) {
      toast.fromApiError(result.error)
      return
    }
    // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
    toast.success('Convite cancelado')
    router.refresh()
  }

  async function handleRevokeActive() {
    const reason = await prompt({
      title: 'Revogar vínculo',
      label: `Motivo da revogação do vínculo com ${patientName}`,
      placeholder: 'Ex: paciente solicitou; mudança de clínica; encerramento de tratamento',
      validator: (v) =>
        v.trim().length < 2
          ? 'Informe um motivo (mín. 2 caracteres)'
          : v.trim().length > 500
            ? 'Motivo deve ter no máximo 500 caracteres'
            : null,
      confirmLabel: 'Revogar vínculo',
    })
    if (!reason) return

    setRevoking(true)
    const result = await revokePatientLink({ linkId: inviteId, reason: reason.trim() })
    setRevoking(false)
    if (!result.ok) {
      toast.fromApiError(result.error)
      return
    }
    // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
    toast.success('Vínculo revogado')
    router.refresh()
  }

  const btnBase = compact
    ? 'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50'
    : 'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === 'pending' && (
          <>
            <button
              type="button"
              onClick={handleCopy}
              disabled={revoking}
              className={btnBase}
              style={{
                borderColor: 'var(--ev-border)',
                background: copyState === 'copied' ? 'var(--ev-success-bg)' : 'var(--ev-surface)',
                color: copyState === 'copied' ? 'var(--ev-success-fg)' : 'var(--ev-text)',
              }}
              aria-label="Copiar link do convite"
            >
              {copyState === 'copied' ? 'Copiado ✓' : 'Copiar link'}
            </button>

            {whatsappShareUrl && (
              <a
                href={whatsappShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={btnBase}
                style={{
                  // design-token-exempt: verde WhatsApp brand é exigência identidade visual
                  borderColor: '#25D366',
                  // design-token-exempt: verde WhatsApp brand é exigência identidade visual
                  background: '#25D366',
                  color: 'white',
                }}
                aria-label="Compartilhar convite via WhatsApp"
              >
                WhatsApp
              </a>
            )}

            <button
              type="button"
              onClick={handleCancelPending}
              disabled={revoking}
              className={btnBase}
              style={{
                borderColor: 'var(--ev-danger)',
                background: 'var(--ev-surface)',
                color: 'var(--ev-danger)',
              }}
              aria-label="Cancelar convite pendente"
            >
              {revoking ? 'Cancelando…' : 'Cancelar convite'}
            </button>
          </>
        )}

        {status === 'active' && (
          <button
            type="button"
            onClick={handleRevokeActive}
            disabled={revoking}
            className={btnBase}
            style={{
              borderColor: 'var(--ev-danger)',
              background: 'var(--ev-surface)',
              color: 'var(--ev-danger)',
            }}
            aria-label="Revogar vínculo ativo"
          >
            {revoking ? 'Revogando…' : 'Revogar vínculo'}
          </button>
        )}
      </div>

      {copyState === 'manual' && (
        <div className="flex items-center gap-2">
          <input
            ref={fallbackInputRef}
            type="text"
            value={inviteUrl}
            readOnly
            aria-label="Link do convite (selecione para copiar)"
            className="flex-1 min-w-0 rounded-md border px-2 py-1 text-xs"
            style={{
              borderColor: 'var(--ev-border)',
              background: 'var(--ev-bg)',
              color: 'var(--ev-text)',
            }}
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
            selecione e copie
          </span>
        </div>
      )}
    </div>
  )
}
