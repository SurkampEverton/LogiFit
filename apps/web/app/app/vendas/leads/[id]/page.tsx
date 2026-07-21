import { db } from '@repo/db/client'
import { leadEvents, leadStages, leads, persons, proposals } from '@repo/db/schema'
/**
 * `/app/vendas/leads/[id]` — detalhe do lead (Sprint 10 Faixa C).
 *
 * Mostra:
 *   - Identidade (person OU quick_*)
 *   - Estágio atual + select para movimentar
 *   - Timeline de lead_events (created → stage_changed → proposal.created → converted)
 *   - Propostas
 *   - Ações: arquivar, converter
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../lib/session'
import { LeadActions } from './lead-actions'
import { LeadStageSelector } from './lead-stage-selector'

export const dynamic = 'force-dynamic'

const STAGE_KIND_COLOR: Record<string, string> = {
  open: 'var(--ev-text-muted)',
  won: 'var(--ev-success, #22c55e)',
  lost: 'var(--ev-danger, #ef4444)',
}

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function LeadDetailPage({ params }: PageProps) {
  const { id } = await params
  const session = await requireFullSession(`/app/vendas/leads/${id}`)
  const tenantId = session.logifit.tenantId

  const [leadRow] = await db
    .select({
      id: leads.id,
      stageId: leads.stageId,
      personId: leads.personId,
      quickName: leads.quickName,
      quickPhone: leads.quickPhone,
      quickEmail: leads.quickEmail,
      source: leads.source,
      interest: leads.interest,
      notes: leads.notes,
      convertedToMemberId: leads.convertedToMemberId,
      lostReason: leads.lostReason,
      archivedAt: leads.archivedAt,
      createdAt: leads.createdAt,
      personName: persons.name,
      personDocument: persons.document,
      stageName: leadStages.name,
      stageKind: leadStages.kind,
    })
    .from(leads)
    .leftJoin(persons, eq(persons.id, leads.personId))
    .leftJoin(leadStages, eq(leadStages.id, leads.stageId))
    .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))
    .limit(1)

  if (!leadRow) return notFound()

  const [stagesRows, eventsRows, proposalsRows] = await Promise.all([
    db
      .select({
        id: leadStages.id,
        slug: leadStages.slug,
        name: leadStages.name,
        orderIdx: leadStages.orderIdx,
        kind: leadStages.kind,
      })
      .from(leadStages)
      .where(and(eq(leadStages.tenantId, tenantId), eq(leadStages.active, true)))
      .orderBy(asc(leadStages.orderIdx)),
    db
      .select({
        id: leadEvents.id,
        kind: leadEvents.kind,
        payload: leadEvents.payload,
        at: leadEvents.at,
      })
      .from(leadEvents)
      .where(eq(leadEvents.leadId, id))
      .orderBy(desc(leadEvents.at))
      .limit(50),
    db
      .select({
        id: proposals.id,
        version: proposals.version,
        priceCents: proposals.priceCents,
        discountCents: proposals.discountCents,
        validUntil: proposals.validUntil,
        status: proposals.status,
        createdAt: proposals.createdAt,
      })
      .from(proposals)
      .where(and(eq(proposals.leadId, id), eq(proposals.tenantId, tenantId)))
      .orderBy(desc(proposals.version)),
  ])

  const displayName = leadRow.personName ?? leadRow.quickName ?? '(sem nome)'
  const isConverted = !!leadRow.convertedToMemberId
  const isArchived = !!leadRow.archivedAt && !isConverted

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">{displayName}</h1>
          <div className="text-sm text-[color:var(--ev-text-muted)]">
            {leadRow.quickPhone ?? '—'}
            {leadRow.quickEmail && ` · ${leadRow.quickEmail}`}
            {leadRow.personDocument && ` · CPF ***${leadRow.personDocument.slice(-4)}`}
          </div>
          <div className="flex gap-2 items-center pt-2">
            <span
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{
                backgroundColor: 'var(--ev-surface)',
                color: STAGE_KIND_COLOR[leadRow.stageKind ?? 'open'],
              }}
            >
              {leadRow.stageName ?? '—'}
            </span>
            {isConverted && (
              <Link
                href={`/app/members/${leadRow.convertedToMemberId}`}
                className="rounded-full px-3 py-1 text-xs font-medium bg-green-100 text-green-800 hover:underline"
              >
                Convertido em member →
              </Link>
            )}
            {isArchived && (
              <span className="rounded-full px-3 py-1 text-xs font-medium bg-red-100 text-red-800">
                Arquivado · {leadRow.lostReason ?? 'sem motivo'}
              </span>
            )}
          </div>
        </div>
        <Link
          href="/app/vendas"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          ← Voltar ao funil
        </Link>
      </header>

      {!isConverted && !isArchived && (
        <section className="rounded-xl border border-[color:var(--ev-border)] p-4 space-y-3">
          <h2 className="text-sm font-medium">Movimentar estágio</h2>
          <LeadStageSelector
            leadId={leadRow.id}
            currentStageId={leadRow.stageId}
            stages={stagesRows}
          />
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[color:var(--ev-border)] p-4 space-y-2">
          <h2 className="text-sm font-medium">Dados</h2>
          <dl className="text-sm space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-[color:var(--ev-text-muted)]">Origem</dt>
              <dd className="font-medium">{leadRow.source}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[color:var(--ev-text-muted)]">Interesse</dt>
              <dd className="text-right">{leadRow.interest ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[color:var(--ev-text-muted)]">Criado em</dt>
              <dd className="tabular-nums">{leadRow.createdAt.toLocaleDateString('pt-BR')}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[color:var(--ev-text-muted)]">Person vinculada</dt>
              <dd className="text-right text-xs">
                {leadRow.personId ? '✓ Confirmada' : '— Captura quick'}
              </dd>
            </div>
          </dl>
          {leadRow.notes && (
            <div className="pt-2 border-t border-[color:var(--ev-border)]">
              <div className="text-xs text-[color:var(--ev-text-muted)]">Notas</div>
              <p className="text-sm whitespace-pre-wrap">{leadRow.notes}</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[color:var(--ev-border)] p-4 space-y-3">
          <h2 className="text-sm font-medium">Propostas ({proposalsRows.length})</h2>
          {proposalsRows.length === 0 ? (
            <p className="text-xs text-[color:var(--ev-text-muted)]">Nenhuma proposta enviada.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {proposalsRows.map((p) => (
                <li key={p.id} className="rounded-md border border-[color:var(--ev-border)] p-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-medium">v{p.version}</div>
                      <div className="text-xs text-[color:var(--ev-text-muted)]">
                        {formatCurrency(p.priceCents - p.discountCents)}
                        {p.discountCents > 0 && (
                          <span className="ml-1 line-through">{formatCurrency(p.priceCents)}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs rounded-full px-2 py-0.5 bg-[color:var(--ev-surface)]">
                      {p.status}
                    </span>
                  </div>
                  <div className="text-xs text-[color:var(--ev-text-muted)] mt-1 tabular-nums">
                    Válida até {p.validUntil.toLocaleDateString('pt-BR')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-4 space-y-3">
        <h2 className="text-sm font-medium">Timeline</h2>
        {eventsRows.length === 0 ? (
          <p className="text-xs text-[color:var(--ev-text-muted)]">Nenhum evento registrado.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {eventsRows.map((e) => (
              <li key={e.id} className="flex gap-3 items-start">
                <span className="rounded-full bg-[color:var(--ev-surface)] px-2 py-0.5 text-xs tabular-nums whitespace-nowrap mt-0.5">
                  {e.at.toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <div className="flex-1">
                  <div className="text-xs font-medium">{e.kind}</div>
                  {e.payload && (
                    <div className="text-xs text-[color:var(--ev-text-muted)] truncate">
                      {e.payload}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {!isConverted && !isArchived && (
        <LeadActions
          leadId={leadRow.id}
          hasPersonId={!!leadRow.personId}
          proposalsList={proposalsRows.map((p) => ({
            id: p.id,
            version: p.version,
            status: p.status,
          }))}
        />
      )}
    </div>
  )
}
