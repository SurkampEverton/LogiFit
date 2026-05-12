import Link from 'next/link'
import { requireFullSession } from '../../lib/session'
import { listMembers } from './actions'

export const dynamic = 'force-dynamic'

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; archived?: string }>
}) {
  await requireFullSession('/app/members')
  const params = await searchParams

  const result = await listMembers({
    query: params.q,
    tag: params.tag,
    includeArchived: params.archived === '1',
    limit: 100,
  })

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Alunos / Pacientes</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Members do tenant — perfil único cross-module (ADR 0011). Cada person PF do tenant pode
            virar 1 member.
          </p>
        </div>
        <Link
          href="/app/members/new"
          className="inline-flex items-center rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm font-medium text-[color:var(--ev-primary-foreground)] hover:opacity-90"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          + Cadastrar member
        </Link>
      </header>

      <form className="flex flex-wrap gap-3" action="/app/members" method="get">
        <input
          type="search"
          name="q"
          defaultValue={params.q}
          placeholder="Buscar por nome, email ou documento"
          className="flex-1 min-w-[200px] rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        />
        <input
          type="text"
          name="tag"
          defaultValue={params.tag}
          placeholder="Tag (vip, inadimplente, ...)"
          className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        />
        <label className="inline-flex items-center gap-2 px-2 text-sm">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={params.archived === '1'}
            className="h-4 w-4 rounded border-[color:var(--ev-border)]"
          />
          incluir arquivados
        </label>
        <button
          type="submit"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 text-sm font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Buscar
        </button>
      </form>

      {!result.ok ? (
        <div role="alert" className="rounded-md border border-[color:var(--ev-danger)] p-4 text-sm">
          Erro: {result.error.message}
        </div>
      ) : result.data.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--ev-border)] p-8 text-center text-sm text-[color:var(--ev-text-muted)]">
          Nenhum member {params.q || params.tag ? 'pra esse filtro' : 'cadastrado ainda'}.{' '}
          <Link
            href="/app/members/new"
            className="font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            Cadastrar primeiro →
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--ev-border)] rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)]">
          {result.data.map((m) => (
            <li key={m.id}>
              <Link
                href={`/app/members/${m.id}`}
                className="block px-4 py-3 hover:bg-[color:var(--ev-bg)]"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{m.personName}</span>
                  {m.personDocument && (
                    <span className="text-sm text-[color:var(--ev-text-muted)]">
                      {m.personDocument}
                    </span>
                  )}
                  {m.archivedAt && (
                    <span className="text-xs rounded-full bg-[color:var(--ev-warning-bg)] px-2 py-0.5">
                      arquivado
                    </span>
                  )}
                </div>
                {m.personEmail && (
                  <p className="text-sm text-[color:var(--ev-text-muted)]">{m.personEmail}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
