import Link from 'next/link'
import { notFound } from 'next/navigation'
import { listMemberAgenda } from '../../agenda/actions'
import { getLatestAssessmentSummary } from '../../avaliacoes/actions'
import { listMemberAchievements, listMemberGoals } from '../../engajamento/actions'
import { listMemberFinanceiro } from '../../financeiro/actions'
import { listMemberCredits } from '../../financeiro/ofertas/actions'
import { listMemberMessages } from '../../mensagens/actions'
import { listMemberPrescriptions } from '../../treinos/actions'
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

  // Widget créditos — Sprint 05 Faixa C
  const creditsResult = await listMemberCredits({ memberId: id })
  const credits = creditsResult.ok ? creditsResult.data.credits : []

  // Widgets engajamento — Sprint 09 Faixa C
  const achResult = await listMemberAchievements({ memberId: id, limit: 5 })
  const earnedAchievements = achResult.ok ? achResult.data.earnedAchievements : []
  const goalsResult = await listMemberGoals({ memberId: id, limit: 5 })
  const activeGoals = goalsResult.ok ? goalsResult.data.activeGoals : []

  // Widget treinos — Sprint 11 Faixa C (prescrições ativas)
  const prescResult = await listMemberPrescriptions({ memberId: id, activeOnly: true, limit: 5 })
  const activePrescriptions = prescResult.ok ? prescResult.data.rows : []

  // Widget avaliações — Sprint 12 Faixa C (última avaliação + cálculos derivados)
  const latestAssessResult = await getLatestAssessmentSummary({ memberId: id })
  const latestAssessment = latestAssessResult.ok ? latestAssessResult.data.latest : null
  const latestAssessmentCalcs = latestAssessResult.ok ? latestAssessResult.data.calculations : []

  // Widget mensagens — Sprint 13 Faixa C (últimas 5 mensagens enviadas)
  const msgsResult = await listMemberMessages({ memberId: id, limit: 5 })
  const recentMessages = msgsResult.ok ? msgsResult.data.rows : []

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
                /
                {activeContract.planBillingCycle === 'monthly'
                  ? 'mês'
                  : activeContract.planBillingCycle}
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

      {/* Widget Créditos — Sprint 05 Faixa C */}
      {credits.length > 0 && (
        <section className="rounded-md border border-[color:var(--ev-border)] p-5 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">🎟️ Créditos ativos</h2>
          <ul className="space-y-2 text-sm">
            {credits.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-1">
                <div className="space-y-0.5 flex-1 min-w-0">
                  <div className="font-medium">{c.serviceType.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-[color:var(--ev-text-muted)]">
                    {c.source === 'bundle' && 'do pacote'}
                    {c.source === 'purchase' && 'comprado'}
                    {c.source === 'referral_reward' && 'recompensa indicação'}
                    {c.source === 'manual_grant' && 'crédito manual'}
                    {c.expiresAt &&
                      ` · expira ${new Date(c.expiresAt).toLocaleDateString('pt-BR')}`}
                  </div>
                </div>
                <div
                  className="tabular-nums text-lg font-semibold"
                  style={{ color: 'var(--ev-primary)' }}
                >
                  {c.balance}
                  <span className="text-xs text-[color:var(--ev-text-muted)]">
                    /{c.initialQuantity}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Widget Conquistas — Sprint 09 Faixa C */}
      {earnedAchievements.length > 0 && (
        <section className="rounded-md border border-[color:var(--ev-border)] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">🏆 Conquistas</h2>
            <Link
              href="/app/engajamento/conquistas"
              className="text-sm font-medium text-[color:var(--ev-primary)] hover:underline"
            >
              catálogo →
            </Link>
          </div>
          <ul className="space-y-2 text-sm">
            {earnedAchievements.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-1">
                <span className="text-2xl">🏅</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{a.achievementName}</div>
                  <div className="text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                    {new Date(a.earnedAt).toLocaleDateString('pt-BR')}
                  </div>
                </div>
                {Number(a.points) > 0 && (
                  <span className="text-xs font-semibold tabular-nums text-[color:var(--ev-primary)]">
                    +{a.points} pts
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Widget Metas — Sprint 09 Faixa C */}
      {activeGoals.length > 0 && (
        <section className="rounded-md border border-[color:var(--ev-border)] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">🎯 Metas ativas</h2>
            <Link
              href="/app/engajamento/metas"
              className="text-sm font-medium text-[color:var(--ev-primary)] hover:underline"
            >
              modelos →
            </Link>
          </div>
          <ul className="space-y-3 text-sm">
            {activeGoals.map((g) => {
              const current = Number(g.currentValue)
              const target = Number(g.targetValue)
              const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
              return (
                <li key={g.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{g.title}</span>
                    <span className="text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                      {current} / {target} {g.targetUnit}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[color:var(--ev-surface-muted)] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${percent}%`,
                        backgroundColor: 'var(--ev-primary)',
                      }}
                    />
                  </div>
                  <div className="text-xs text-[color:var(--ev-text-muted)] tabular-nums flex justify-between">
                    <span>{percent}%</span>
                    <span>até {new Date(g.targetDate).toLocaleDateString('pt-BR')}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Widget Treinos — Sprint 11 Faixa C */}
      <section className="rounded-md border border-[color:var(--ev-border)] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">🏋️ Treinos prescritos</h2>
          <Link
            href={`/app/members/${id}/treino`}
            className="text-sm font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            ficha completa →
          </Link>
        </div>
        {activePrescriptions.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] italic">
            Nenhuma prescrição ativa.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {activePrescriptions.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {p.kind === 'workout'
                      ? (p.workoutName ?? '(workout removido)')
                      : `Prescrição ${p.kind}`}
                  </div>
                  <div className="text-xs text-[color:var(--ev-text-muted)]">
                    {p.workoutGoal && `${p.workoutGoal} · `}
                    {p.workoutVersion && `v${p.workoutVersion} · `}
                    desde {new Date(p.startsAt).toLocaleDateString('pt-BR')}
                  </div>
                </div>
                {p.kind === 'workout' && p.refId && (
                  <Link
                    href={`/app/treinos/${p.refId}`}
                    className="text-xs text-[color:var(--ev-primary)] hover:underline shrink-0"
                  >
                    ver ficha
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Widget Avaliações — Sprint 12 Faixa C */}
      <section className="rounded-md border border-[color:var(--ev-border)] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">📊 Última avaliação</h2>
          <Link
            href={`/app/members/${id}/avaliacoes`}
            className="text-sm font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            todas →
          </Link>
        </div>
        {latestAssessment === null ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] italic">
            Nenhuma avaliação registrada.{' '}
            <Link href={`/app/members/${id}/avaliacoes/new`} className="underline">
              Registrar primeira
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium">
                {latestAssessment.typeName ?? '(tipo removido)'}
              </div>
              <div className="text-xs text-[color:var(--ev-text-muted)]">
                {new Date(latestAssessment.performedAt).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </div>
            </div>
            {latestAssessmentCalcs.length > 0 && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                {latestAssessmentCalcs.slice(0, 3).map((c) => (
                  <div
                    key={c.calcKey}
                    className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-2"
                  >
                    <div className="uppercase text-[10px] text-[color:var(--ev-text-muted)]">
                      {c.calcKey === 'imc'
                        ? 'IMC'
                        : c.calcKey === 'pct_gordura_pollock7'
                          ? '% Gordura'
                          : c.calcKey === 'tmb_mifflin'
                            ? 'TMB'
                            : c.calcKey === 'rcq'
                              ? 'RCQ'
                              : c.calcKey === 'massa_magra_kg'
                                ? 'Mag. magra'
                                : c.calcKey}
                    </div>
                    <div className="font-medium tabular-nums">
                      {Number(c.value).toLocaleString('pt-BR', {
                        maximumFractionDigits: 1,
                      })}
                    </div>
                    {c.classification && (
                      <div className="text-[10px] text-[color:var(--ev-text-muted)] truncate">
                        {c.classification}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Link
              href={`/app/members/${id}/avaliacoes/${latestAssessment.id}`}
              className="text-xs text-[color:var(--ev-primary)] hover:underline"
            >
              ver detalhes →
            </Link>
          </div>
        )}
      </section>

      {/* Widget Mensagens — Sprint 13 Faixa C */}
      <section className="rounded-md border border-[color:var(--ev-border)] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">💬 Mensagens recentes</h2>
          <Link
            href="/app/mensagens/historico"
            className="text-sm font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            histórico →
          </Link>
        </div>
        {recentMessages.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] italic">
            Nenhuma mensagem registrada.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {recentMessages.map((m) => (
              <li
                key={m.id}
                className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-2"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">
                    {m.channel === 'whatsapp' ? '🟢' : m.channel === 'email' ? '📧' : '📱'}{' '}
                    {m.templateName ?? '(manual)'}
                  </span>
                  <span className="text-[10px] text-[color:var(--ev-text-muted)] uppercase">
                    {m.status}
                  </span>
                </div>
                {m.bodyRendered && (
                  <p className="text-xs text-[color:var(--ev-text-muted)] italic line-clamp-2 mt-1">
                    {m.bodyRendered}
                  </p>
                )}
                <div className="text-[10px] text-[color:var(--ev-text-muted)] mt-1">
                  {new Date(m.createdAt).toLocaleDateString('pt-BR')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Slot futuro restante — Sprint 06 (IA Copilot já estará Sprint 06 done) */}
      <section className="rounded-md border border-dashed border-[color:var(--ev-border)] p-6 text-center text-xs text-[color:var(--ev-text-muted)]">
        <p>
          Widget futuro: <strong>IA Copilot</strong> contextualizado ao member (Sprint 06 Faixa D
          pendente)
        </p>
      </section>
    </main>
  )
}
