import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@repo/db/client'
import { persons } from '@repo/db/schema'
import { requireFullSession, withSessionContext } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireFullSession(`/app/pessoas`)
  const { id } = await params

  const person = await withSessionContext(session.logifit, async () => {
    const rows = await db.select().from(persons).where(eq(persons.id, id)).limit(1)
    return rows[0] ?? null
  })

  if (!person) notFound()

  const address = (person.address as Record<string, string | null> | null) ?? null

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href="/app/pessoas"
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar pra pessoas
        </Link>
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{person.name}</h1>
          <span className="text-sm uppercase text-[color:var(--ev-text-muted)]">
            {person.kind === 'pf' ? 'Pessoa Física' : 'Pessoa Jurídica'}
          </span>
          {person.archivedAt && (
            <span className="text-xs rounded-full bg-[color:var(--ev-warning-bg)] px-2 py-0.5">
              arquivada
            </span>
          )}
        </div>
        {person.displayName && (
          <p className="text-base text-[color:var(--ev-text-muted)]">{person.displayName}</p>
        )}
      </header>

      <section className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 space-y-3">
        <h2 className="text-xl font-semibold">Dados</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
          {person.document && (
            <div>
              <dt className="font-medium text-[color:var(--ev-text-muted)]">
                {person.kind === 'pf' ? 'CPF' : 'CNPJ'}
              </dt>
              <dd>{person.document}</dd>
            </div>
          )}
          {person.email && (
            <div>
              <dt className="font-medium text-[color:var(--ev-text-muted)]">Email</dt>
              <dd>{person.email}</dd>
            </div>
          )}
          {person.phone && (
            <div>
              <dt className="font-medium text-[color:var(--ev-text-muted)]">Telefone</dt>
              <dd>{person.phone}</dd>
            </div>
          )}
          {person.birthDate && (
            <div>
              <dt className="font-medium text-[color:var(--ev-text-muted)]">Nascimento</dt>
              <dd>{person.birthDate}</dd>
            </div>
          )}
          {address && (
            <div className="sm:col-span-2">
              <dt className="font-medium text-[color:var(--ev-text-muted)]">Endereço</dt>
              <dd>
                {[address.logradouro, address.numero, address.bairro, address.cidade, address.uf]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {person.kind === 'pf' && (
        <section className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 space-y-3">
          <h2 className="text-xl font-semibold">Papéis</h2>
          <ul className="space-y-2 text-sm">
            <li>
              <Link
                href={`/app/pessoas/${person.id}/registros`}
                className="text-[color:var(--ev-primary)] hover:underline"
              >
                Registros profissionais (CRM/CRN/CREFITO/CREF) →
              </Link>
            </li>
            {/* Sprint 02+: + Member, User, Profissional clínico, etc */}
          </ul>
        </section>
      )}
    </main>
  )
}
