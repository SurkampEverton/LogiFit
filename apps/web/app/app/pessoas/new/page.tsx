import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { NewPersonForm } from './new-person-form'

export default async function NewPersonPage() {
  await requireFullSession('/app/pessoas/new')

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href="/app/pessoas"
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar pra pessoas
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Nova pessoa</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Digite o CPF (11 dígitos) ou CNPJ (14 dígitos) — detectamos o tipo automaticamente. CNPJ
          válido busca dados na Receita Federal.
        </p>
      </header>

      <NewPersonForm />
    </main>
  )
}
