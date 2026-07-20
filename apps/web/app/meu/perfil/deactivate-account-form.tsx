'use client'

import { confirm } from '@repo/ui/messages'
import { useRouter } from 'next/navigation'
/**
 * /meu/perfil — desativar conta (Sprint 02b4 — passport_global, LGPD art. 18 VI).
 *
 * Ação destrutiva — requireMfa: true + mfaMaxAgeMs: 5min (janela mais estrita
 * que default 15min). Soft delete; paciente tem 30 dias pra reativar via suporte.
 *
 * UX:
 *   1. Botão "Desativar minha conta" expande form
 *   2. Form pede reason (radio) + confirmEmail digitado
 *   3. ConfirmDialog dupla (regra 45 + ADR 0089)
 *   4. Após sucesso: mostra mensagem + redirect /meu/login após 5s (session revogada)
 */
import { useEffect, useState, useTransition } from 'react'
import { deactivateAccount } from './passport-actions'

interface Props {
  /** Email registrado da identity — pra mostrar hint do confirmEmail */
  email: string
}

export function DeactivateAccountForm({ email }: Props) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [reason, setReason] = useState<'user_request' | 'lgpd_erasure'>('user_request')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Após sucesso, redirect /meu/login após 5s (session já revogada server-side)
  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => {
      router.push('/meu/login')
      router.refresh()
    }, 5000)
    return () => clearTimeout(t)
  }, [success, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (confirmEmail.toLowerCase() !== email.toLowerCase()) {
      setErr('Email de confirmação não bate')
      return
    }
    const ok = await confirm({
      title: 'Desativar conta — última confirmação',
      body: `Sua conta LogiFit será desativada. Você tem 30 dias pra reativar via privacidade@logifit.com.br antes do hard delete LGPD art. 18 VI. Todas as sessões serão encerradas imediatamente.`,
      confirmLabel: 'Sim, desativar',
      danger: true,
    })
    if (!ok) return
    startTransition(async () => {
      try {
        const r = (await deactivateAccount({ reason, confirmEmail })) as
          | { ok: true; note?: string }
          | { ok: false; error?: { code?: string; message?: string } }
        if ('ok' in r && !r.ok) {
          if (r.error?.code === 'MFA_RECENT_REQUIRED') {
            setErr(
              'Verificação MFA expirou (>5min pra esta ação) — faça login de novo pra desativar',
            )
            return
          }
          setErr(r.error?.message ?? 'Falha ao desativar conta')
          return
        }
        setSuccess(true)
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'MFA_RECENT_REQUIRED') {
          setErr('Verificação MFA expirou (>5min) — faça login de novo')
          return
        }
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  if (success) {
    return (
      <div
        style={{
          padding: 'var(--ev-space-md)',
          background: 'var(--ev-surface-muted)',
          borderLeft: '4px solid var(--ev-success)',
          borderRadius: 'var(--ev-radius-sm)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>✓ Conta desativada</h3>
        <p style={{ fontSize: 'var(--ev-text-sm)' }}>
          Você tem <strong>30 dias</strong> pra reativar entrando em contato com{' '}
          <code>privacidade@logifit.com.br</code>. Após esse período, seus dados pessoais serão
          excluídos definitivamente (LGPD art. 18 VI).
        </p>
        <p style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
          Redirecionando pra /meu/login em alguns segundos...
        </p>
      </div>
    )
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="ev-portal-button ev-portal-button--ghost"
        style={{ color: 'var(--ev-danger)' }}
      >
        Desativar minha conta...
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="ev-portal-form"
      style={{
        padding: 'var(--ev-space-md)',
        background: 'var(--ev-danger-soft, var(--ev-surface-muted))',
        borderLeft: '4px solid var(--ev-danger)',
        borderRadius: 'var(--ev-radius-sm)',
      }}
    >
      <h3 style={{ marginTop: 0, color: 'var(--ev-danger)' }}>⚠ Desativar conta</h3>
      <p style={{ fontSize: 'var(--ev-text-sm)' }}>
        Esta ação <strong>encerra todas as sessões</strong> e marca sua conta como desativada. Você
        tem 30 dias pra reativar via suporte antes do hard delete LGPD art. 18 VI.
      </p>

      <fieldset style={{ border: '1px solid var(--ev-border)', padding: 'var(--ev-space-2)' }}>
        <legend style={{ fontSize: 'var(--ev-text-sm)' }}>Motivo</legend>
        <label style={{ display: 'block', fontSize: 'var(--ev-text-sm)' }}>
          <input
            type="radio"
            name="reason"
            value="user_request"
            checked={reason === 'user_request'}
            onChange={() => setReason('user_request')}
            disabled={pending}
          />{' '}
          Não quero mais usar (pode reativar depois)
        </label>
        <label style={{ display: 'block', fontSize: 'var(--ev-text-sm)' }}>
          <input
            type="radio"
            name="reason"
            value="lgpd_erasure"
            checked={reason === 'lgpd_erasure'}
            onChange={() => setReason('lgpd_erasure')}
            disabled={pending}
          />{' '}
          Exercer direito à exclusão LGPD (art. 18 VI — dados serão excluídos em 30d)
        </label>
      </fieldset>

      <label className="ev-portal-label" htmlFor="confirm-email">
        Digite seu email pra confirmar
      </label>
      <input
        id="confirm-email"
        type="email"
        value={confirmEmail}
        onChange={(e) => setConfirmEmail(e.target.value)}
        placeholder={email}
        className="ev-portal-input"
        required
        disabled={pending}
      />

      {err ? (
        <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
      ) : null}

      <div style={{ display: 'flex', gap: 'var(--ev-space-2)' }}>
        <button
          type="submit"
          disabled={pending || confirmEmail.toLowerCase() !== email.toLowerCase()}
          className="ev-portal-button"
          style={{ background: 'var(--ev-danger)' }}
        >
          {pending ? 'Desativando...' : 'Desativar minha conta'}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false)
            setConfirmEmail('')
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
