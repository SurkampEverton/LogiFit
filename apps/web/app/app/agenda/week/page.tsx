import { type VirtualSlot, expandRecurring } from '@repo/db/agenda'
import { db } from '@repo/db/client'
import { appointments, recurringSlots, resources } from '@repo/db/schema'
/**
 * `/app/agenda/week` — Canvas semanal visão grade (Sprint 03 Faixa D).
 *
 * Layout 7 dias × 12 horas (8h-20h slot 1h). Cada célula renderiza
 * appointments + slots recorrentes virtualizados via `expandRecurring()`.
 * Click em slot vazio → /app/agenda/new pré-preenchido. Click em
 * appointment existente → /app/agenda/[id].
 *
 * Drag&drop completo fica adiado pra Sprint 04+ (UX nice-to-have, sem
 * dor real MVP — operador cria via wizard `/new` é OK).
 *
 * Realtime: client component `<WeekCanvasLive>` (Faixa D Realtime stub)
 * fica adiado — SSE listener em página própria.
 */
import { and, eq, gte, lte } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { RealtimeRefresh } from '../realtime-refresh'

export const dynamic = 'force-dynamic'

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i) // 8h → 20h

/**
 * Helper: começo da semana (segunda) a partir de uma data qualquer.
 * Convenção pt-BR: semana começa na segunda.
 */
function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  const day = d.getUTCDay() // 0=Dom 1=Seg ...
  const diff = day === 0 ? -6 : 1 - day // ir pra segunda
  d.setUTCDate(d.getUTCDate() + diff)
  return d
}

export default async function AgendaWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>
}) {
  const session = await requireFullSession('/app/agenda/week')
  const params = await searchParams

  const today = new Date()
  const weekStart = params.start ? startOfWeek(new Date(params.start)) : startOfWeek(today)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekStart.getUTCDate() + 7)

  // Carrega appointments do range + recurring_slots ativos do tenant
  const [bookedRows, recurringRows] = await Promise.all([
    db
      .select({
        id: appointments.id,
        resourceId: appointments.resourceId,
        memberId: appointments.memberId,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, session.logifit.tenantId),
          gte(appointments.startsAt, weekStart),
          lte(appointments.startsAt, weekEnd),
        ),
      ),
    db
      .select({
        id: recurringSlots.id,
        resourceId: recurringSlots.resourceId,
        rrule: recurringSlots.rrule,
        startTime: recurringSlots.startTime,
        endTime: recurringSlots.endTime,
        capacity: recurringSlots.capacity,
      })
      .from(recurringSlots)
      .where(
        and(eq(recurringSlots.tenantId, session.logifit.tenantId), eq(recurringSlots.active, true)),
      ),
  ])

  // Expande RRULE → slots virtuais no range
  const virtualSlots: VirtualSlot[] = recurringRows.flatMap((rs) =>
    expandRecurring({
      recurringSlotId: rs.id,
      rrule: rs.rrule,
      startTime: rs.startTime as string,
      endTime: rs.endTime as string,
      rangeStart: weekStart,
      rangeEnd: weekEnd,
    }),
  )

  // Map de slot virtual → appointment booked (mesmo recurring_slot_id + starts_at)
  const bookedBySlot = new Map<string, (typeof bookedRows)[number]>()
  for (const a of bookedRows) {
    const key = `${a.resourceId}|${a.startsAt.toISOString()}`
    bookedBySlot.set(key, a)
  }

  // Tabela final de células por dia + hora
  type Cell = {
    booked: (typeof bookedRows)[number] | null
    virtual: VirtualSlot | null
  }
  const grid: Cell[][] = HOURS.map(() =>
    Array.from({ length: 7 }, () => ({ booked: null, virtual: null })),
  )

  for (const a of bookedRows) {
    const start = new Date(a.startsAt)
    const dayIdx = (start.getUTCDay() + 6) % 7 // 0=Seg, 6=Dom (convertido)
    const hourIdx = start.getUTCHours() - 8
    const cell = grid[hourIdx]?.[dayIdx]
    if (cell) cell.booked = a
  }

  for (const v of virtualSlots) {
    const start = new Date(v.startsAt)
    const dayIdx = (start.getUTCDay() + 6) % 7
    const hourIdx = start.getUTCHours() - 8
    const cell = grid[hourIdx]?.[dayIdx]
    if (cell && cell.booked == null) cell.virtual = v
  }

  // Map resources pra exibir nome
  const resourceRows = await db
    .select({ id: resources.id, name: resources.name })
    .from(resources)
    .where(eq(resources.tenantId, session.logifit.tenantId))
  const resourceNameById = new Map(resourceRows.map((r) => [r.id, r.name]))

  // Datas do header (cada coluna)
  const headerDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setUTCDate(weekStart.getUTCDate() + i)
    return d
  })

  // Navegação prev/next semana
  const prevWeek = new Date(weekStart)
  prevWeek.setUTCDate(weekStart.getUTCDate() - 7)
  const nextWeek = new Date(weekStart)
  nextWeek.setUTCDate(weekStart.getUTCDate() + 7)

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-4">
      <RealtimeRefresh />
      <nav className="text-sm">
        <Link href="/app/agenda" className="text-[color:var(--ev-text-muted)] hover:underline">
          ← Voltar para Agenda
        </Link>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Semana de {weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} —{' '}
          {new Date(weekEnd.getTime() - 1).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'short',
          })}
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/app/agenda/week?start=${prevWeek.toISOString().slice(0, 10)}`}
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            ← Semana anterior
          </Link>
          <Link
            href="/app/agenda/week"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            Hoje
          </Link>
          <Link
            href={`/app/agenda/week?start=${nextWeek.toISOString().slice(0, 10)}`}
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            Próxima →
          </Link>
        </div>
      </header>

      <div className="overflow-x-auto rounded-xl border border-[color:var(--ev-border)]">
        <table className="w-full text-xs">
          <thead className="bg-[color:var(--ev-surface-muted)]">
            <tr>
              <th className="px-2 py-2 text-left font-medium w-16">Hora</th>
              {headerDates.map((d, i) => (
                <th key={d.toISOString()} className="px-2 py-2 text-left font-medium">
                  <div>{DAYS_PT[(i + 1) % 7]}</div>
                  <div className="text-[color:var(--ev-text-muted)] tabular-nums">
                    {d.getUTCDate().toString().padStart(2, '0')}/
                    {(d.getUTCMonth() + 1).toString().padStart(2, '0')}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((h, hourIdx) => (
              <tr key={h} className="border-t border-[color:var(--ev-border)]">
                <td className="px-2 py-2 align-top text-[color:var(--ev-text-muted)] tabular-nums">
                  {h.toString().padStart(2, '0')}:00
                </td>
                {Array.from({ length: 7 }, (_, dayIdx) => {
                  const cell = grid[hourIdx]?.[dayIdx] ?? { booked: null, virtual: null }
                  const date = headerDates[dayIdx]
                  if (!date) return <td key={dayIdx} />
                  const slotIso = new Date(date)
                  slotIso.setUTCHours(h, 0, 0, 0)
                  const createHref = `/app/agenda/new?start=${slotIso.toISOString()}`

                  if (cell.booked) {
                    return (
                      <td
                        key={dayIdx}
                        className="border-l border-[color:var(--ev-border)] p-1 align-top"
                      >
                        <Link
                          href={`/app/agenda/${cell.booked.id}`}
                          className="block rounded-sm px-1.5 py-1 text-[color:var(--ev-primary-foreground,white)] hover:opacity-90 break-words"
                          style={{
                            backgroundColor:
                              cell.booked.status === 'checked_in'
                                ? 'var(--ev-success, #10b981)'
                                : 'var(--ev-primary)',
                          }}
                        >
                          {resourceNameById.get(cell.booked.resourceId) ?? '?'}
                        </Link>
                      </td>
                    )
                  }
                  if (cell.virtual) {
                    return (
                      <td
                        key={dayIdx}
                        className="border-l border-[color:var(--ev-border)] p-1 align-top"
                      >
                        <Link
                          href={createHref}
                          className="block rounded-sm px-1.5 py-1 text-[color:var(--ev-text-muted)] hover:bg-[color:var(--ev-surface)] border border-dashed border-[color:var(--ev-border)]"
                        >
                          {resourceNameById.get(cell.virtual.recurringSlotId) ?? 'slot livre'}
                        </Link>
                      </td>
                    )
                  }
                  return (
                    <td
                      key={dayIdx}
                      className="border-l border-[color:var(--ev-border)] p-1 align-top"
                    >
                      <Link
                        href={createHref}
                        aria-label={`Criar em ${date.getUTCDate()}/${date.getUTCMonth() + 1} ${h}:00`}
                        className="block rounded-sm px-1.5 py-1 text-[color:var(--ev-text-muted)] hover:bg-[color:var(--ev-surface)] opacity-30 hover:opacity-100 text-center"
                      >
                        +
                      </Link>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[color:var(--ev-text-muted)]">
        Click em <strong>+</strong> em célula vazia cria appointment ad-hoc. Drag&amp;drop para
        mover entre slots fica em backlog (Sprint 04+).
      </p>
    </div>
  )
}
