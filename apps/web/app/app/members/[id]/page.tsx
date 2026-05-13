import Link from 'next/link'
import { notFound } from 'next/navigation'
import { listMemberAgenda } from '../../agenda/actions'
import { listMemberFinanceiro } from '../../financeiro/actions'
import { getMember, listTimeline } from '../actions'

export const dynamic = 'force-dynamic'

const KIND_LABELS: Record<string, string> = {
  'member.created': 'Cadastrado',
  'member.updated': 'Atualizado',
  'member.archived': 'Arquivado',
  'member.transferred': 'Transferido entre companies',
  'member.note_added': 'Anotação adicionada',
  'member.tag_added': 'Tag adicionada',
  'member.tag_removed': 'Tag removida',
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const detailResult = await getMember({ id })
  if (!detailResult.ok || !detailResult.data) notFound()
  const { member, person, company, tags } = detailResult.data

  // Timeline resumida (últimos 10 eventos) — widget overview ADR 0011
  const timelineResult = await listTimeline({ memberId: id, limit: 10 })
  const timeline = timelineResult.ok ? timelineResult.data : []

  // Widget agenda — Sprint 03 Faixa D (próximos 5 appointments)
  const agendaResult = await listMemberAgenda({ memberId: id, limit: 5 })
  const upcomingAppointments = agendaResult.ok ? agendaResult.data.upcoming : []

  // Widget financeiro — Sprint 04 Faixa C (contrato ativo + invoices recentes)
  const financResult = await listMemberFinanceiro({ memberId: id })
  const activeContract = financResult.ok ? financResult.data.activeContract : null
  const recentInvoices = financResult.ok ? financResult.data.recentInvoices : []

  const address = (person.address as Record<string, string | null> | null) ?? null

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href="/app/members"
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar pra members
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{person.name}</h1>
          {member.archivedAt && (
            <span className="text-xs rounded-full bg-[color:var(--ev-warning-bg)] px-2 py-0.5">
              arquivado
            </span>
          )}
        </div>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          {company.type === 'matriz' ? 'Matriz' : 'Filial'}: {member.companyId.slice(0, 8)}…
          {person.document && ` · CPF ${person.document}`}
        </p>
      </header>

      {/* Slot OVERVIEW — ADR 0011 widget único MVP */}
      <section
        aria-labelledby="overview"
        className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 space-y-4"
      >
        <h2 id="overview" className="text-xl font-semibold">
          Visão geral
        </h2>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
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
          {address && (address.cidade || address.uf) && (
            <div>
              <dt className="font-medium text-[color:var(--ev-text-muted)]">Cidade</dt>
              <dd>{[address.cidade, address.uf].filter(Boolean).join(' · ')}</dd>
            </div>
          )}
        </dl>

        {tags.length > 0 && (
          <div>
            <dt className="text-sm font-medium text-[color:var(--ev-text-muted)]">Tags</dt>
            <dd className="mt-1 flex flex-wrap gap-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="text-xs rounded-full bg-[color:var(--ev-surface)] border border-[color:var(--ev-border)] px-2 py-0.5"
                >
                  {t}
                </span>
              ))}
            </dd>
          </div>
        )}
      </section>

      {/* Slot TIMELINE — últimos 10 eventos */}
      <section
        aria-labelledby="timeline"
        className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 space-y-4"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="timeline" className="text-xl font-semibold">
            Timeline
          </h2>
          <Link
            href={`/app/members/${id}/timeline`}
            className="text-sm text-[color:var(--ev-primary)] hover:underline"
          >
            Ver completo →
          </Link>
        </div>

        {timeline.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)]">Nenhum evento ainda.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {timeline.map((e) => (
              <li key={e.id} className="flex items-start gap-3">
                <span className="text-xs text-[color:var(--ev-text-muted)] tabular-nums w-32 shrink-0">
                  {new Date(e.at).toLocaleString('pt-BR')}
                </span>
                <span>{KIND_LABELS[e.kind] ?? e.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Widget Agenda — Sprint 03 Faixa D */}
      <section className="rounded-md border border-[color:var(--ev-border)] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">📅 Próximos agendamentos</h2>
          <Link
            href={`/app/agenda/new?memberId=${id}`}
            className="text-sm font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            + Agendar
          </Link>
        </div>
        {upcomingAppointments.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] py-2">
            Sem agendamentos futuros.{' '}
            <Link
              href={`/app/agenda/new?memberId=${id}`}
              className="text-[color:var(--ev-primary)] hover:underline"
            >
              Criar primeiro →
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--ev-border)]">
            {upcomingAppointments.map((a) => (
              <li key={a.id} className="py-2 flex items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{a.resourceName}</div>
                  <div className="text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                    {new Date(a.startsAt).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
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
                {a.status === 'checked_in' && (
                  <span className="text-xs text-[color:var(--ev-success,#10b981)] font-medium shrink-0">
                    ✓ check-in
                  </span>
                )}
                <Link
                  href={`/app/agenda/${a.id}`}
                  className="text-xs text-[color:var(--ev-primary)] hover:underline shrink-0"
                >
                  ver →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Widget Financeiro — Sprint 04 Faixa C */}
      <section className="rounded-md border border-[color:var(--ev-border)] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">💰 Financeiro</h2>
          <Link
            href="/app/financeiro/contratos"
            className="text-sm font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            ver tudo →
          </Link>
        </div>
        {activeContract ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[color:var(--ev-text-muted)]">Plano ativo</span>
              <span className="font-medium tabular-nums">
                {activeContract.planName} —{' '}
                {(activeContract.planPriceCents / 100).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
                /{activeContract.planBillingCycle === 'monthly' ? 'mês' : activeContract.planBillingCycle}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-[color:var(--ev-text-muted)]">
              <span>Desde {new Date(activeContract.startedAt).toLocaleDateString('pt-BR')}</span>
              <span>Vencimento dia {activeContract.billingDay}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[color:var(--ev-text-muted)] py-2">Sem contrato ativo.</p>
        )}
        {recentInvoices.length > 0 && (
          <div className="pt-2 border-t border-[color:var(--ev-border)] space-y-1">
            <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
              Cobranças recentes
            </div>
            <ul className="space-y-1 text-xs">
              {recentInvoices.slice(0, 3).map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3">
                  <span className="text-[color:var(--ev-text-muted)] tabular-nums">
                    {new Date(inv.dueAt).toLocaleDateString('pt-BR')}
                  </span>
                  <span className="tabular-nums">
                    {(inv.amountCents / 100).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </span>
                  <span
                    className="font-medium"
                    style={{
                      color:
                        inv.status === 'paid'
                          ? 'var(--ev-success, #10b981)'
                          : inv.status === 'overdue'
                            ? 'var(--ev-danger, #ef4444)'
                            : 'var(--ev-text-muted)',
                    }}
                  >
                    {inv.status === 'paid'
                      ? '✓ paga'
                      : inv.status === 'overdue'
                        ? '⚠ atraso'
                        : inv.status === 'pending'
                          ? 'pendente'
                          : inv.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Slots futuros — Sprint 06/08/09 */}
      <section className="rounded-md border border-dashed border-[color:var(--ev-border)] p-6 text-center text-sm text-[color:var(--ev-text-muted)]">
        <p>
          Widgets futuros: <strong>IA Copilot</strong> (Sprint 06) · <strong>Acessos</strong>{' '}
          (Sprint 08) · <strong>Conquistas</strong> (Sprint 09)
        </p>
      </section>
    </main>
  )
}
