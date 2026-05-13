/**
 * `/app/agenda` — visão de agenda (Sprint 03 Faixa C inicial).
 *
 * MVP: lista plana de appointments próximos 7 dias por resource.
 * Faixa C avançada: visão semanal/mensal canvas + drag & drop.
 */
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'
import { listAppointments, listResources } from './actions'
import { RealtimeRefresh } from './realtime-refresh'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  booked: 'Agendado',
  checked_in: 'Check-in',
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

export default async function AgendaPage() {
  await requireFullSession('/app/agenda')

  // Window: hoje 00:00 → +7 dias
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = new Date(from)
  to.setDate(to.getDate() + 7)

  const [resourcesResult, appointmentsResult] = await Promise.all([
    listResources({ includeArchived: false, limit: 50 }),
    listAppointments({ from: from.toISOString(), to: to.toISOString() }),
  ])

  const resourcesById = new Map<string, string>()
  if (resourcesResult.ok) {
    for (const r of resourcesResult.data.resources) resourcesById.set(r.id, r.name)
  }

  const appointments = appointmentsResult.ok ? appointmentsResult.data.appointments : []

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Próximos 7 dias — Sprint 03 Faixa C (visão semanal canvas + drag&drop em Faixa D).
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/app/agenda/new"
            className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 font-medium text-[color:var(--ev-primary-foreground)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            + Agendamento
          </Link>
          <Link
            href="/app/agenda/week"
            className="rounded-md border border-[color:var(--ev-border)] px-4 py-2"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            Visão semanal
          </Link>
          <Link
            href="/app/agenda/resources"
            className="rounded-md border border-[color:var(--ev-border)] px-4 py-2"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            Recursos
          </Link>
        </div>
      </header>

      <RealtimeRefresh />

      {appointments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-8 text-center">
          <p className="text-[color:var(--ev-text-muted)]">
            Nenhum agendamento nos próximos 7 dias.
          </p>
          <Link
            href="/app/agenda/new"
            className="mt-3 inline-block font-medium text-[color:var(--ev-primary)]"
          >
            Criar primeiro agendamento →
          </Link>
        </div>
      ) : (
        <section className="rounded-xl border border-[color:var(--ev-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--ev-surface-muted)] text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Início</th>
                <th className="px-4 py-3 font-medium">Recurso</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((appt) => (
                <tr key={appt.id} className="border-t border-[color:var(--ev-border)]">
                  <td className="px-4 py-3">
                    {new Date(appt.startsAt).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3">{resourcesById.get(appt.resourceId) ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      style={{
                        color: STATUS_COLOR[appt.status] ?? 'var(--ev-text)',
                        fontWeight: 500,
                      }}
                    >
                      {STATUS_LABEL[appt.status] ?? appt.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/agenda/${appt.id}`}
                      className="text-[color:var(--ev-primary)] hover:underline"
                    >
                      Detalhes
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
