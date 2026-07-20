'use client'

import { confirm } from '@repo/ui/messages'
import { useRouter } from 'next/navigation'
/**
 * /meu/perfil — revoke session passport (Sprint 02b4 — passport_global).
 *
 * Diferente de `revoke-session-button.tsx` Sprint 26 (member_sessions),
 * este chama `revokeMyPassportSession` SA com `wrapPassportAction({
 * requireMfa: true })`.
 */
import { useState, useTransition } from 'react'
import { revokeMyPassportSession } from './passport-actions'

interface Props {
  sessionId: string
  deviceLabel: string | null
}

export function PassportSessionRevokeButton({ sessionId, deviceLabel }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  async function handleClick() {
    setErr(null)
    const ok = await confirm({
      title: 'Encerrar este dispositivo?',
      body: `${deviceLabel ?? 'O dispositivo'} será deslogado imediatamente. Para entrar novamente, precisará digitar email + senha (+ TOTP se MFA ativo).`,
      confirmLabel: 'Encerrar',
      danger: true,
    })
    if (!ok) return
    startTransition(async () => {
      try {
        const r = (await revokeMyPassportSession({ sessionId })) as
          | { ok: true }
          | { ok: false; error?: { code?: string; message?: string } }
        if ('ok' in r && !r.ok) {
          if (r.error?.code === 'MFA_RECENT_REQUIRED') {
            setErr(
              'Verificação MFA expirou (>15min) — faça login de novo pra encerrar dispositivos',
            )
            return
          }
          setErr(r.error?.message ?? 'Falha ao encerrar')
          return
        }
        router.refresh()
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'MFA_RECENT_REQUIRED') {
          setErr('Verificação MFA expirou (>15min) — faça login de novo')
          return
        }
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="ev-portal-button ev-portal-button--ghost"
        style={{ fontSize: 'var(--ev-text-xs)' }}
      >
        {pending ? 'Encerrando...' : 'Encerrar'}
      </button>
      {err ? (
        <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-xs)' }}>{err}</p>
      ) : null}
    </>
  )
}
