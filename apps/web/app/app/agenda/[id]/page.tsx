/**
 * `/app/agenda/[id]` — detalhe + ações (cancel + check-in).
 *
 * Sprint 03 Faixa C. Carrega via getAppointment + lookup recurso/member.
 * `<AppointmentActions>` (Client) faz cancel/check-in via Server Actions.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../lib/session'
import { getAppointment, listResources } from '../actions'
import { AppointmentActions } from './appointment-actions'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  booked: 'Agendado',
  checked_in: 'Check-in feito',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
  completed: 'Concluído',
}

const STATUS_COLOR: Record<string, string> = {
  booked: 'var(--ev-primary)',
  checked_in: 'var(--ev-success, #10b981)',
  cancelled: 'var(--ev-text-muted)',
  no_show: 'var(--ev-danger, #ef4444)',
  completed: 'var(--ev-text-muted)',
}

export default async function AppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireFullSession(`/app/agenda/${id}`)

  const result = await getAppointment({ appointmentId: id })
  if (!result.ok) notFound()
  const appt = result.data

  // Lookup nome do recurso
  const resourcesResult = await listResources({ includeArchived: true, limit: 200 })
  const resourceName = resourcesResult.ok
    ? (resourcesResult.data.resources.find((r) => r.id === appt.resourceId)?.name ?? '—')
    : '—'

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link href="/app/agenda" className="text-[color:var(--ev-text-muted)] hover:underline">
          ← Voltar para Agenda
        </Link>
      </nav>

      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Agendamento</h1>
          <span
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{
              backgroundColor: 'var(--ev-surface-muted)',
              color: STATUS_COLOR[appt.status] ?? 'var(--ev-text)',
            }}
          >
            {STATUS_LABEL[appt.status] ?? appt.status}
          </span>
        </div>
      </header>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-[color:var(--ev-text-muted)]">Início</dt>
            <dd className="font-medium">
              {new Date(appt.startsAt).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--ev-text-muted)]">Fim</dt>
            <dd className="font-medium">
              {new Date(appt.endsAt).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--ev-text-muted)]">Recurso</dt>
            <dd className="font-medium">{resourceName}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--ev-text-muted)]">Member</dt>
            <dd>
              <Link
                href={`/app/members/${appt.memberId}`}
                className="font-medium text-[color:var(--ev-primary)] hover:underline"
              >
                Ver perfil →
              </Link>
            </dd>
          </div>
          {appt.checkedInAt && (
            <div>
              <dt className="text-[color:var(--ev-text-muted)]">Check-in em</dt>
              <dd className="font-medium">
                {new Date(appt.checkedInAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </dd>
            </div>
          )}
          {appt.cancelledAt && (
            <div className="col-span-2">
              <dt className="text-[color:var(--ev-text-muted)]">Cancelado em</dt>
              <dd className="font-medium">
                {new Date(appt.cancelledAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {appt.cancelledReason && (
                  <span className="block text-xs text-[color:var(--ev-text-muted)] mt-1">
                    Motivo: {appt.cancelledReason}
                  </span>
                )}
              </dd>
            </div>
          )}
        </div>
      </section>

      {/* Ações: client component só pra status que aceita ação */}
      {(appt.status === 'booked' || appt.status === 'checked_in') && (
        <AppointmentActions appointmentId={appt.id} status={appt.status} />
      )}
    </div>
  )
}
