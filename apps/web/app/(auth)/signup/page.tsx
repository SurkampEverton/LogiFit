/**
 * /signup — onboarding wizard que cria tenant + matriz + user admin atomicamente.
 *
 * Sprint 01a Faixa B: skeleton "comming soon". Wizard completo entra na
 * Faixa E (onboarding + topology UI) — depende de Faixa D (persons CRUD)
 * + lookup CNPJ + validação CPF do user admin.
 *
 * Por que separar de /login: signup cria recurso (tenant), login só autentica.
 */
export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Criar conta</h1>
      <p className="mt-4 text-base text-[color:var(--ev-text-muted)]">
        O onboarding completo entra na Sprint 01a Faixa E.
      </p>
      <p className="mt-2 text-sm text-[color:var(--ev-text-muted)]">
        Já tem conta?{' '}
        <a href="/login" className="font-medium text-[color:var(--ev-primary)] hover:underline">
          Entrar
        </a>
      </p>
    </main>
  )
}
