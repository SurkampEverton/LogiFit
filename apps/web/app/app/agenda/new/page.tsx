/**
 * `/app/agenda/new` — wizard cadastro agendamento (Sprint 03 Faixa C).
 *
 * Server Component carrega listas de members + resources disponíveis;
 * passa pra `<NewAppointmentForm>` (Client) que faz submit via Server Action.
 */
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { listMembers } from '../../members/actions'
import { listResources } from '../actions'
import { NewAppointmentForm } from './new-appointment-form'

export const dynamic = 'force-dynamic'

export default async function NewAppointmentPage() {
  await requireFullSession('/app/agenda/new')

  const [resourcesResult, membersResult] = await Promise.all([
    listResources({ includeArchived: false, limit: 100 }),
    listMembers({ limit: 100 }),
  ])

  const resources = resourcesResult.ok
    ? resourcesResult.data.resources.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
      }))
    : []
  const members = membersResult.ok
    ? membersResult.data.map((m) => ({ id: m.id, name: m.personName }))
    : []

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Novo agendamento</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Sprint 03 — booking ad-hoc (sem recorrência ainda). RRULE expand vem em Faixa D.
        </p>
      </header>

      {resources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-center">
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Nenhum recurso cadastrado.{' '}
            <Link
              href="/app/agenda/resources/new"
              className="font-medium text-[color:var(--ev-primary)]"
            >
              Cadastrar primeiro recurso →
            </Link>
          </p>
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-center">
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Nenhum member cadastrado.{' '}
            <Link href="/app/members/new" className="font-medium text-[color:var(--ev-primary)]">
              Cadastrar primeiro member →
            </Link>
          </p>
        </div>
      ) : (
        <NewAppointmentForm availableResources={resources} availableMembers={members} />
      )}
    </div>
  )
}
