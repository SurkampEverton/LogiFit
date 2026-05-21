'use client'

/**
 * Form de troca de email (Sprint 02b5).
 *
 * UX: paciente clica "Trocar email" → expande form com 2 inputs
 * (senha atual + novo email) → submit chama `requestPassportEmailChange`
 * → mostra mensagem "verifique o novo email" + reseta form.
 *
 * Trata erro especial MFA_RECENT_REQUIRED (regra 43 — Server Action
 * exige MFA recente <15min) com mensagem específica.
 */
import { useState, useTransition } from 'react'
import { requestPassportEmailChange } from './passport-actions'

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [expanded, setExpanded] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [pending, startTransition] = useTransition()
  const [doneMessage, setDoneMessage] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setDoneMessage(null)
    setErr(null)
    startTransition(async () => {
      try {
        const r = (await requestPassportEmailChange({
          currentPassword,
          newEmail,
        })) as
          | { ok: true; note?: string }
          | { ok: false; error?: { code?: string; message?: string } }
        if ('ok' in r && !r.ok) {
          if (r.error?.code === 'MFA_RECENT_REQUIRED') {
            setErr(
              'Verificação MFA expirou (>15min) — faça login de novo pra trocar o email',
            )
            return
          }
          setErr(r.error?.message ?? 'Falha ao solicitar troca de email')
          return
        }
        // Sucesso — mostra mensagem persistente + reseta form
        setDoneMessage(r.note ?? 'Verifique o novo email pra ativar a troca.')
        setCurrentPassword('')
        setNewEmail('')
        setExpanded(false)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  if (doneMessage) {
    return (
      <div
        style={{
          background: 'var(--ev-success-soft, var(--ev-surface-muted))',
          borderLeft: '4px solid var(--ev-success)',
          padding: 'var(--ev-space-md)',
          borderRadius: 'var(--ev-radius-sm)',
        }}
      >
        <p style={{ margin: 0, fontSize: 'var(--ev-text-sm)' }}>{doneMessage}</p>
        <button
          type="button"
          onClick={() => setDoneMessage(null)}
          className="ev-portal-button ev-portal-button--ghost"
          style={{ marginTop: 'var(--ev-space-2)' }}
        >
          Fechar
        </button>
      </div>
    )
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="ev-portal-button ev-portal-button--ghost"
      >
        Trocar email
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="ev-portal-form">
      <p style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
        Confirme sua senha atual e o novo email. Vamos enviar um link pro novo endereço — clique
        nele pra ativar a troca.
      </p>

      <div>
        <label className="ev-portal-label" htmlFor="current-password">
          Senha atual
        </label>
        <input
          id="current-password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
          minLength={8}
          className="ev-portal-input"
        />
      </div>

      <div>
        <label className="ev-portal-label" htmlFor="new-email">
          Novo email
        </label>
        <input
          id="new-email"
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          autoComplete="email"
          required
          maxLength={255}
          className="ev-portal-input"
        />
        <p
          className="ev-portal-muted"
          style={{ fontSize: 'var(--ev-text-xs)', marginTop: 'var(--ev-space-1)' }}
        >
          Email atual: {currentEmail}
        </p>
      </div>

      {err ? (
        <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
      ) : null}

      <div style={{ display: 'flex', gap: 'var(--ev-space-2)' }}>
        <button
          type="submit"
          disabled={pending || !currentPassword || !newEmail}
          className="ev-portal-button"
        >
          {pending ? 'Enviando...' : 'Enviar link pro novo email'}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false)
            setCurrentPassword('')
            setNewEmail('')
            setErr(null)
          }}
          disabled={pending}
          className="ev-portal-button ev-portal-button--ghost"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
