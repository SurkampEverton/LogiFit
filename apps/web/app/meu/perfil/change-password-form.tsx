'use client'

import { confirm } from '@repo/ui/messages'
import { useRouter } from 'next/navigation'
/**
 * /meu/perfil — form trocar senha (Sprint 02b4 — passport_global_identities).
 *
 * Chama `changePassword` SA com `wrapPassportAction({ requireMfa: true })`.
 * Se paciente não tem MFA recente, backend retorna MFA_RECENT_REQUIRED →
 * frontend pode redirecionar pra re-login (paciente precisa fazer login
 * fresh com TOTP pra ter mfa_verified_at recente).
 */
import { useState, useTransition } from 'react'
import { changePassword } from './passport-actions'

export function ChangePasswordForm() {
  const router = useRouter()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setSuccess(false)
    if (newPassword !== newPasswordConfirm) {
      setErr('Confirmação da nova senha não bate')
      return
    }
    const ok = await confirm({
      title: 'Trocar senha?',
      body: 'Outras sessões (dispositivos onde você está logado) serão encerradas. Você permanece logado neste dispositivo.',
      confirmLabel: 'Trocar senha',
      danger: true,
    })
    if (!ok) return
    startTransition(async () => {
      try {
        const r = (await changePassword({ oldPassword, newPassword })) as
          | { ok: true; note?: string }
          | { ok: false; error?: { code?: string; message?: string } }
        if ('ok' in r && !r.ok) {
          if (r.error?.code === 'MFA_RECENT_REQUIRED') {
            setErr('Verificação MFA expirou (>15min) — faça login de novo pra trocar a senha')
            return
          }
          setErr(r.error?.message ?? 'Falha ao trocar senha')
          return
        }
        setSuccess(true)
        setOldPassword('')
        setNewPassword('')
        setNewPasswordConfirm('')
        router.refresh() // re-render pra atualizar sessions list
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
    <form onSubmit={handleSubmit} className="ev-portal-form">
      <label className="ev-portal-label" htmlFor="old-password">
        Senha atual
      </label>
      <input
        id="old-password"
        type="password"
        value={oldPassword}
        onChange={(e) => setOldPassword(e.target.value)}
        autoComplete="current-password"
        minLength={8}
        className="ev-portal-input"
        required
        disabled={pending}
      />

      <label className="ev-portal-label" htmlFor="new-password">
        Nova senha (mín 8 chars)
      </label>
      <input
        id="new-password"
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        autoComplete="new-password"
        minLength={8}
        className="ev-portal-input"
        required
        disabled={pending}
      />

      <label className="ev-portal-label" htmlFor="new-password-confirm">
        Confirme a nova senha
      </label>
      <input
        id="new-password-confirm"
        type="password"
        value={newPasswordConfirm}
        onChange={(e) => setNewPasswordConfirm(e.target.value)}
        autoComplete="new-password"
        minLength={8}
        className="ev-portal-input"
        required
        disabled={pending}
      />

      {err ? (
        <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
      ) : null}

      {success ? (
        <p style={{ color: 'var(--ev-success)', fontSize: 'var(--ev-text-sm)' }}>
          ✓ Senha alterada. Outras sessões foram encerradas.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !oldPassword || !newPassword || !newPasswordConfirm}
        className="ev-portal-button"
      >
        {pending ? 'Trocando...' : 'Trocar senha'}
      </button>
    </form>
  )
}
