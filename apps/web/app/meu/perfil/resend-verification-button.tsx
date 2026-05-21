'use client'

/**
 * Botão de reenvio de email de confirmação (Sprint 02b5).
 *
 * Renderizado em `/meu/perfil` quando `email_verified_at IS NULL`. Cooldown
 * 5min no servidor — UX mostra mensagem após sucesso/falha + auto-dismiss
 * em 5s pro caso de erro (volta a poder clicar).
 *
 * Sem MFA gate — `wrapPassportAction({ requireMfa: false })` no server.
 */
import { useState, useTransition } from 'react'
import { resendPassportEmailVerification } from './passport-actions'

export function ResendVerificationButton({ currentEmail }: { currentEmail: string }) {
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; message: string; alreadyVerified: boolean }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  function handleClick() {
    setStatus({ kind: 'idle' })
    startTransition(async () => {
      try {
        const r = (await resendPassportEmailVerification()) as
          | { ok: true; alreadyVerified: boolean; sent?: boolean; note?: string }
          | { ok: false; error?: { code?: string; message?: string } }
        if ('ok' in r && !r.ok) {
          setStatus({
            kind: 'error',
            message: r.error?.message ?? 'Falha ao reenviar email',
          })
          // Reset depois de 5s pra usuário poder tentar de novo
          setTimeout(() => setStatus({ kind: 'idle' }), 5000)
          return
        }
        setStatus({
          kind: 'success',
          message: r.note ?? 'Email reenviado',
          alreadyVerified: r.alreadyVerified,
        })
      } catch (e) {
        setStatus({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Erro inesperado',
        })
        setTimeout(() => setStatus({ kind: 'idle' }), 5000)
      }
    })
  }

  if (status.kind === 'success') {
    return (
      <div
        style={{
          background: status.alreadyVerified
            ? 'var(--ev-info-soft, var(--ev-surface-muted))'
            : 'var(--ev-success-soft, var(--ev-surface-muted))',
          borderLeft: `4px solid ${status.alreadyVerified ? 'var(--ev-info)' : 'var(--ev-success)'}`,
          padding: 'var(--ev-space-2) var(--ev-space-md)',
          borderRadius: 'var(--ev-radius-sm)',
          fontSize: 'var(--ev-text-sm)',
        }}
      >
        {status.alreadyVerified ? 'ℹ️' : '✓'} {status.message}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="ev-portal-button ev-portal-button--ghost"
      >
        {pending ? 'Enviando...' : `Reenviar pra ${currentEmail}`}
      </button>
      {status.kind === 'error' ? (
        <p
          style={{
            color: 'var(--ev-danger)',
            fontSize: 'var(--ev-text-sm)',
            marginTop: 'var(--ev-space-1)',
          }}
        >
          {status.message}
        </p>
      ) : null}
    </div>
  )
}
