/**
 * `/app/dashboard/recepcao` — dashboard role-aware recepção (Sprint 07 Faixa B).
 *
 * Foco operacional: agenda do dia + check-ins live + members em atraso.
 * Sprint 08 Faixa C plugga Realtime SSE acesso pra feed atualizar sem reload.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  accessEvents,
  appointments,
  invoices,
  members,
  persons,
} from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function DashboardRecepcaoPage() {
  const session = await requireFullSession('/app/dashboard/recepcao')
  const tenantId = session.logifit.tenantId
  const now = new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(startOfDay)
  endOfDay.setDate(startOfDay.getDate() + 1)

  const [todayAppointments, recentCheckins, overdueMembers] = await Promise.all([
    db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        memberName: persons.name,
        memberId: appointments.memberId,
      })
      .from(appointments)
      .innerJoin(members, eq(members.id, appointments.memberId))
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          gte(appointments.startsAt, startOfDay),
          lte(appointments.startsAt, endOfDay),
        ),
      )
      .orderBy(appointments.startsAt)
      .limit(50),
    db
      .select({
        id: accessEvents.id,
        kind: accessEvents.kind,
        at: accessEvents.at,
        memberName: persons.name,
      })
      .from(accessEvents)
      .leftJoin(members, eq(members.id, accessEvents.memberId))
      .leftJoin(persons, eq(persons.id, members.personId))
      .where(eq(accessEvents.tenantId, tenantId))
      .orderBy(desc(accessEvents.at))
      .limit(10),
    db
      .select({
        id: invoices.id,
        amountCents: invoices.amountCents,
        dueAt: invoices.dueAt,
        memberId: invoices.memberId,
        memberName: persons.name,
      })
      .from(invoices)
      .innerJoin(members, eq(members.id, invoices.memberId))
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'overdue')))
      .orderBy(invoices.dueAt)
      .limit(10),
  ])

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      <nav className="text-sm">
        <Link href="/app" className="text-[color:var(--ev-text-muted)] hover:underline">
          ← Voltar para Dashboard
        </Link>
      </nav>

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Recepção</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Visão operacional: agenda do dia + check-ins + cobranças vencidas
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Agenda do dia */}
        <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">📅 Agenda de hoje</h2>
            <Link
              href="/app/agenda/week"
              className="text-xs text-[color:var(--ev-primary)] hover:underline"
            >
              ver semana →
            </Link>
          </div>
          {todayAppointments.length === 0 ? (
            <p className="text-sm text-[color:var(--ev-text-muted)] py-2">
              Sem agendamentos hoje.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--ev-border)]">
              {todayAppointments.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <Link
                      href={`/app/agenda/${a.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {a.memberName}
                    </Link>
                    <div className="text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                      {new Date(a.startsAt).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' → '}
                      {new Date(a.endsAt).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <span
                    className="text-xs font-medium shrink-0"
                    style={{
                      color:
                        a.status === 'checked_in'
                          ? 'var(--ev-success, #10b981)'
                          : a.status === 'cancelled'
                            ? 'var(--ev-text-muted)'
                            : 'var(--ev-primary)',
                    }}
                  >
                    {a.status === 'booked' && 'Agendado'}
                    {a.status === 'checked_in' && '✓ check-in'}
                    {a.status === 'cancelled' && 'cancelado'}
                    {a.status === 'completed' && 'concluído'}
                    {a.status === 'no_show' && '⚠ no-show'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Check-ins recentes */}
        <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">🚪 Check-ins recentes</h2>
            <Link
              href="/app/acesso/checkins"
              className="text-xs text-[color:var(--ev-primary)] hover:underline"
            >
              feed live →
            </Link>
          </div>
          {recentCheckins.length === 0 ? (
            <p className="text-sm text-[color:var(--ev-text-muted)] py-2">
              Sem check-ins ainda. Catraca precisa estar online.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--ev-border)] text-sm">
              {recentCheckins.map((e) => (
                <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                  <span className="font-medium">{e.memberName ?? '—'}</span>
                  <span className="text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                    {new Date(e.at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Overdue */}
      <section className="rounded-xl border border-[color:var(--ev-danger)] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2 text-[color:var(--ev-danger)]">
            ⚠ Members em atraso
          </h2>
          <Link
            href="/app/financeiro/cobrancas?status=overdue"
            className="text-xs text-[color:var(--ev-primary)] hover:underline"
          >
            ver todas →
          </Link>
        </div>
        {overdueMembers.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] py-2">
            Nenhum member em atraso. 🎉
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--ev-border)] text-sm">
            {overdueMembers.map((inv) => (
              <li key={inv.id} className="py-2 flex items-center justify-between gap-3">
                <Link href={`/app/members/${inv.memberId}`} className="font-medium hover:underline">
                  {inv.memberName}
                </Link>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                    venceu {new Date(inv.dueAt).toLocaleDateString('pt-BR')}
                  </span>
                  <span className="font-medium tabular-nums text-[color:var(--ev-danger)]">
                    {formatBRL(inv.amountCents)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
