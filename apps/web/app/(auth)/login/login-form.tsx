'use client'

import { authClient } from '@repo/auth/client'
import { useState } from 'react'

/**
 * Login via magic link (ADR 0092).
 *
 * Fluxo:
 *   1. user digita email + envia
 *   2. `authClient.signIn.magicLink()` POSTa pra /api/auth/sign-in/magic-link
 *   3. BetterAuth chama `sendMagicLink` (server-side em @repo/auth/server)
 *   4. user clica link no email → /api/auth/magic-link/verify?token=...
 *      → cookie `logifit.session_token` setado → redirect pra `returnTo` ou `/app`
 *
 * Sprint 01a Faixa B: log no servidor + Mailhog (dev). Faixa B fechamento
 * pluga email real (Brevo — ADR 0096 substitui AWS SES).
 */
export function LoginForm({
  returnTo,
  initialError,
}: {
  returnTo?: string
  initialError?: string
}) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError ?? null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setStatus('sending')
    setErrorMessage(null)

    try {
      const { error } = await authClient.signIn.magicLink({
        email,
        callbackURL: returnTo ?? '/app',
      })
      if (error) {
        setStatus('error')
        // toast-exempt: mensagem vem do BetterAuth (i18n nativo do plugin)
        // Faixa B fechamento mapeia error.code → t('errors.AUTH_*')
        setErrorMessage(error.message ?? 'Falha ao enviar link')
        return
      }
      setStatus('sent')
    } catch (_err) {
      setStatus('error')
      setErrorMessage('Erro de rede. Tente novamente.')
    }
  }

  if (status === 'sent') {
    return (
      <div
        role="status"
        className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-4 text-sm"
      >
        <p className="font-medium">Link enviado!</p>
        <p className="mt-1 text-[color:var(--ev-text-muted)]">
          Confira <strong>{email}</strong> e clique no link em até 15 minutos.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={errorMessage ? 'login-email-error' : undefined}
          aria-invalid={status === 'error'}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base focus:border-[color:var(--ev-primary)] focus:outline-none"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          placeholder="voce@exemplo.com.br"
        />
        {errorMessage && (
          <p id="login-email-error" className="text-sm text-[color:var(--ev-danger)]" role="alert">
            {errorMessage}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={status === 'sending' || !email}
        className="block w-full rounded-md bg-[color:var(--ev-primary)] px-4 py-3 text-center text-base font-medium text-[color:var(--ev-primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
      >
        {status === 'sending' ? 'Enviando…' : 'Enviar link mágico'}
      </button>

      <p className="text-center text-sm text-[color:var(--ev-text-muted)]">
        Não tem conta?{' '}
        <a href="/signup" className="font-medium text-[color:var(--ev-primary)] hover:underline">
          Criar tenant
        </a>
      </p>
    </form>
  )
}
