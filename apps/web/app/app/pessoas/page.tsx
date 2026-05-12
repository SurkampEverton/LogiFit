import Link from 'next/link'
import { requireFullSession } from '../../lib/session'
import { searchPersons } from './actions'

export const dynamic = 'force-dynamic'

export default async function PessoasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: 'pf' | 'pj' }>
}) {
  await requireFullSession('/app/pessoas')
  const params = await searchParams

  const result = await searchPersons({
    query: params.q,
    kind: params.kind,
    limit: 50,
  })

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Pessoas</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Cadastro central PF/PJ (ADR 0047). Mesma pessoa pode ter múltiplos papéis (member,
            user, supplier, profissional, company).
          </p>
        </div>
        <Link
          href="/app/pessoas/new"
          className="inline-flex items-center rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm font-medium text-[color:var(--ev-primary-foreground)] hover:opacity-90"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          + Nova pessoa
        </Link>
      </header>

      <form className="flex flex-wrap gap-3" action="/app/pessoas" method="get">
        <input
          type="search"
          name="q"
          defaultValue={params.q}
          placeholder="Buscar por nome, documento ou email"
          className="flex-1 min-w-[200px] rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        />
        <select
          name="kind"
          defaultValue={params.kind ?? ''}
          className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          <option value="">Todos</option>
          <option value="pf">Pessoa Física</option>
          <option value="pj">Pessoa Jurídica</option>
        </select>
        <button
          type="submit"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 text-sm font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Buscar
        </button>
      </form>

      {!result.ok ? (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--ev-danger)] bg-[color:var(--ev-surface)] p-4 text-sm"
        >
          Erro ao buscar pessoas: {result.error.message}
        </div>
      ) : result.data.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-8 text-center">
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Nenhuma pessoa cadastrada {params.q ? `pra "${params.q}"` : 'ainda'}.
          </p>
          <Link
            href="/app/pessoas/new"
            className="mt-3 inline-block text-sm font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            Cadastrar primeira pessoa →
          </Link>
        </div>
      ) : (
        <section aria-label="Lista de pessoas">
          <ul className="divide-y divide-[color:var(--ev-border)] rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)]">
            {result.data.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
                    {p.kind === 'pf' ? 'PF' : 'PJ'}
                  </span>
                  {p.document && (
                    <span className="text-sm text-[color:var(--ev-text-muted)]">
                      {p.document}
                    </span>
                  )}
                  {p.archivedAt && (
                    <span className="text-xs rounded-full bg-[color:var(--ev-warning-bg)] px-2 py-0.5">
                      arquivada
                    </span>
                  )}
                </div>
                {p.email && (
                  <p className="text-sm text-[color:var(--ev-text-muted)]">{p.email}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
