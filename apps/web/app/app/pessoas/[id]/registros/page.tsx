import { db } from '@repo/db/client'
import { persons } from '@repo/db/schema'
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession, withSessionContext } from '../../../../lib/session'
import { listRegistrations } from './actions'
import { RegistrosClient } from './registros-client'

export const dynamic = 'force-dynamic'

export default async function RegistrosPage({
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
  if (person.kind !== 'pf') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8 space-y-4">
        <Link
          href={`/app/pessoas/${id}`}
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar
        </Link>
        <div role="alert" className="rounded-md border border-[color:var(--ev-warning)] p-4">
          Registros profissionais só se aplicam a Pessoa Física (esta é{' '}
          {person.kind === 'pj' ? 'PJ' : '—'}).
        </div>
      </main>
    )
  }

  const result = await listRegistrations({ personId: id })
  const registrations = result.ok ? result.data : []

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href={`/app/pessoas/${id}`}
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar para {person.name}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Registros profissionais</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Conselhos de classe (CRM, CRN, CREFITO, CREF). Constraint global LogiFit detecta mesmo
          número em 2 tenants (fraude).
        </p>
      </header>

      <RegistrosClient personId={id} initialRegistrations={registrations} />
    </main>
  )
}
