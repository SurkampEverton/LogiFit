import { db } from '@repo/db/client'
import { members, persons } from '@repo/db/schema'
/**
 * `/app/fisio/evolucoes/new?memberId=X` — criação rápida (Sprint 21 Faixa C).
 */
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireFullSession } from '../../../../lib/session'
import { NewEvolucaoForm } from './new-evolucao-form'

export const dynamic = 'force-dynamic'

export default async function NewEvolucaoPage({
  searchParams,
}: { searchParams: Promise<{ memberId?: string; appointmentId?: string }> }) {
  const params = await searchParams
  const memberId = params.memberId
  if (!memberId) redirect('/app/members')

  const session = await requireFullSession(`/app/fisio/evolucoes/new?memberId=${memberId}`)
  const tenantId = session.logifit.tenantId

  const [member] = await db
    .select({ id: members.id, name: persons.name })
    .from(members)
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1)
  if (!member) notFound()

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)', maxWidth: 720 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Nova evolução</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{member.name ?? '—'}</span>
        <span style={{ flex: 1 }} />
        <Link href={`/app/fisio/pacientes/${memberId}/evolucoes`} className="ev-btn ev-btn-ghost">
          ← Voltar
        </Link>
      </header>

      <NewEvolucaoForm memberId={memberId} appointmentId={params.appointmentId ?? null} />
    </div>
  )
}
