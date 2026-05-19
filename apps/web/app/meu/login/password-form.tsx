'use client'

/**
 * /meu/login — password form (Sprint 02b3 ADR 0094).
 *
 * Form email + password + opcional TOTP (mostrado em segundo passo se backend
 * retorna MFA_REQUIRED). Sprint 02b3 completo: substitui placeholder '000000'
 * por otplib real.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { loginPassport } from './actions'

export function PasswordLoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    startTransition(async () => {
      try {
        const r = (await loginPassport({
          email,
          password,
          totp: step === 'mfa' ? totp : undefined,
        })) as
          | { ok: true; passportGlobalId: string; mfaVerified: boolean; redirectUrl: string }
          | { ok: false; error?: { code?: string; message?: string } }
        if ('ok' in r && !r.ok) {
          if (r.error?.code === 'MFA_RECENT_REQUIRED') {
            setStep('mfa')
            return
          }
          setErr(r.error?.message ?? 'Credenciais inválidas')
          return
        }
        // Sucesso → redirect pra dashboard /meu
        router.push(r.redirectUrl)
        router.refresh()
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'MFA_RECENT_REQUIRED') {
          setStep('mfa')
          return
        }
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  if (step === 'mfa') {
    return (
      <form onSubmit={handleSubmit} className="ev-portal-form">
        <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-sm)' }}>
          Digite o código de 6 dígitos do seu autenticador (Google Authenticator,
          Authy, 1Password, etc).
        </p>
        <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-xs)' }}>
          🛠 Sprint 02b3 partial: TOTP placeholder aceita <code>000000</code>. Wizard
          MFA TOTP real entra em Sprint 02b3 completo (otplib).
        </p>

        <label className="ev-portal-label" htmlFor="totp">
          Código TOTP
        </label>
        <input
          id="totp"
          type="text"
          value={totp}
          onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          className="ev-portal-input"
          required
          autoFocus
        />

        {err ? (
          <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
        ) : null}

        <button type="submit" disabled={pending || totp.length !== 6} className="ev-portal-button">
          {pending ? 'Verificando...' : 'Entrar'}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep('credentials')
            setTotp('')
            setErr(null)
          }}
          disabled={pending}
          className="ev-portal-button ev-portal-button--ghost"
        >
          ← Voltar
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="ev-portal-form">
      <label className="ev-portal-label" htmlFor="login-email">
        Email
      </label>
      <input
        id="login-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        className="ev-portal-input"
        required
        disabled={pending}
      />

      <label className="ev-portal-label" htmlFor="login-password">
        Senha
      </label>
      <input
        id="login-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        minLength={8}
        className="ev-portal-input"
        required
        disabled={pending}
      />

      {err ? (
        <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
      ) : null}

      <button type="submit" disabled={pending} className="ev-portal-button">
        {pending ? 'Entrando...' : 'Entrar'}
      </button>

      <p style={{ marginTop: 'var(--ev-space-md)', fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)', textAlign: 'center' }}>
        Esqueceu a senha? Use o magic link (aba ao lado) ou cadastre-se em <code>/cadastro</code>.
      </p>
    </form>
  )
}
