import Link from 'next/link'
import { SignupWizard } from './signup-wizard'

/**
 * /signup — onboarding wizard atômico (Sprint 01a Faixa E).
 *
 * Cria tenant + person matriz PJ + company + unit + user admin + role
 * `tenant_owner` em uma transação. Envia magic link pro admin completar
 * primeiro login.
 */
export default function SignupPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Criar conta LogiFit</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Trial 14 dias sem cartão. Após o trial, dados ficam retidos por 30 dias para conversão.
        </p>
      </header>

      <SignupWizard />

      <p className="text-center text-sm text-[color:var(--ev-text-muted)]">
        Já tem conta?{' '}
        <Link href="/login" className="font-medium text-[color:var(--ev-primary)] hover:underline">
          Entrar
        </Link>
      </p>
    </main>
  )
}
