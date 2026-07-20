import { db } from '@repo/db/client'
import { persons } from '@repo/db/schema'
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession, withSessionContext } from '../../../lib/session'
import { type PersonAddress, PersonForm } from '../person-form'

export const dynamic = 'force-dynamic'

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireFullSession(`/app/pessoas`)
  const { id } = await params

  const person = await withSessionContext(session.logifit, async () => {
    // Escopo explicito de tenant: buscar so por id deixaria qualquer pessoa
    // de qualquer tenant acessivel pela URL (a RLS nao alcanca o pool do Drizzle).
    const rows = await db
      .select()
      .from(persons)
      .where(and(eq(persons.id, id), eq(persons.tenantId, session.logifit.tenantId)))
      .limit(1)
    return rows[0] ?? null
  })

  if (!person) notFound()

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

      <section className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 space-y-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-xl font-semibold">Dados cadastrais</h2>
          {person.document && (
            <span className="text-sm text-[color:var(--ev-text-muted)]">
              {person.kind === 'pf' ? 'CPF' : 'CNPJ'}: {person.document}
            </span>
          )}
        </div>

        {/* Fonte única de identidade, contato e endereço — telas especializadas
            (empresa, member) apontam pra cá em vez de recriar os campos. */}
        <PersonForm
          initial={{
            id: person.id,
            name: person.name,
            displayName: person.displayName,
            email: person.email,
            phone: person.phone,
            address: (person.address as PersonAddress | null) ?? null,
          }}
        />
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
