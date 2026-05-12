import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { listAvailablePjPersons } from '../actions'
import { NewFilialForm } from './new-filial-form'

export const dynamic = 'force-dynamic'

export default async function NewFilialPage() {
  await requireFullSession('/app/settings/empresas/new')
  const result = await listAvailablePjPersons()

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href="/app/settings/empresas"
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Nova filial</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Selecione uma pessoa jurídica já cadastrada ou{' '}
          <Link
            href="/app/pessoas/new"
            className="font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            cadastre uma nova PJ primeiro
          </Link>
          .
        </p>
      </header>

      {!result.ok ? (
        <div role="alert" className="rounded-md border border-[color:var(--ev-danger)] p-4 text-sm">
          Erro ao listar PJs disponíveis: {result.error.message}
        </div>
      ) : result.data.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--ev-border)] p-8 text-center text-sm text-[color:var(--ev-text-muted)]">
          Nenhuma PJ disponível —{' '}
          <Link
            href="/app/pessoas/new"
            className="font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            cadastre uma PJ primeiro
          </Link>{' '}
          em <code>/app/pessoas/new</code>.
        </div>
      ) : (
        <NewFilialForm availablePersons={result.data} />
      )}
    </main>
  )
}
