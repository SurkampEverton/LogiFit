/**
 * `/app/financeiro/adquirencia/[id]/antecipacao` — solicitação de antecipação (Sprint 18 Faixa C).
 *
 * Lista vendas elegíveis (status captured/settled + não antecipadas) e permite
 * selecionar conjunto → quota antecipação → confirmar.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@repo/db/client'
import { acquirerConnections, acquirerSales, anticipations } from '@repo/db/schema'
import { requireFullSession } from '../../../../../lib/session'
import { AnticipationForm } from './anticipation-form'

export const dynamic = 'force-dynamic'

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function AnticipationPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/financeiro/adquirencia/${id}/antecipacao`)
  const tenantId = session.logifit.tenantId

  const [conn] = await db
    .select()
    .from(acquirerConnections)
    .where(and(eq(acquirerConnections.id, id), eq(acquirerConnections.tenantId, tenantId)))
    .limit(1)
  if (!conn) notFound()

  const eligible = await db
    .select({
      id: acquirerSales.id,
      externalId: acquirerSales.externalId,
      capturedAt: acquirerSales.capturedAt,
      netAmountCents: acquirerSales.netAmountCents,
      cardBrand: acquirerSales.cardBrand,
      cardKind: acquirerSales.cardKind,
      installments: acquirerSales.installments,
      expectedSettlementDate: acquirerSales.expectedSettlementDate,
      status: acquirerSales.status,
    })
    .from(acquirerSales)
    .where(
      and(
        eq(acquirerSales.connectionId, id),
        eq(acquirerSales.tenantId, tenantId),
        isNull(acquirerSales.reconciledAt),
      ),
    )
    .orderBy(desc(acquirerSales.expectedSettlementDate))
    .limit(200)

  const elegibleFiltered = eligible.filter((s) => s.status === 'captured' || s.status === 'settled')

  const history = await db
    .select({
      id: anticipations.id,
      status: anticipations.status,
      originalAmountCents: anticipations.originalAmountCents,
      anticipatedAmountCents: anticipations.anticipatedAmountCents,
      feeCents: anticipations.feeCents,
      effectiveRatePct: anticipations.effectiveRatePct,
      requestedAt: anticipations.requestedAt,
      creditedAt: anticipations.creditedAt,
      salesIds: anticipations.salesIds,
    })
    .from(anticipations)
    .where(and(eq(anticipations.connectionId, id), eq(anticipations.tenantId, tenantId)))
    .orderBy(desc(anticipations.requestedAt))
    .limit(20)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Antecipação — {conn.nickname ?? conn.provider}</h1>
        <span style={{ flex: 1 }} />
        <Link href={`/app/financeiro/adquirencia/${id}/vendas`} className="ev-btn ev-btn-ghost">
          ← Voltar
        </Link>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0 }}>
          Solicita antecipação de recebíveis pendentes. Provider aplica taxa
          mensal sobre o valor original — quanto mais próximo do settlement, menor
          o custo. <strong>Mock approva sempre com 1.99% a.m.</strong>; adapters
          reais (Stone/Cielo) variam por contrato no Sprint 18b.
        </p>
      </div>

      <h2>Vendas elegíveis ({elegibleFiltered.length})</h2>
      {elegibleFiltered.length === 0 ? (
        <p>Nenhuma venda elegível. Sincronize primeiro.</p>
      ) : (
        <AnticipationForm
          connectionId={id}
          sales={elegibleFiltered.map((s) => ({
            id: s.id,
            externalId: s.externalId,
            capturedAt: s.capturedAt.toISOString(),
            netAmountCents: s.netAmountCents,
            cardBrand: s.cardBrand ?? '—',
            cardKind: s.cardKind,
            installments: s.installments,
            expectedSettlementDate: s.expectedSettlementDate,
          }))}
        />
      )}

      <h2>Histórico de antecipações</h2>
      {history.length === 0 ? (
        <p>Nenhuma antecipação registrada.</p>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Data</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Original</th>
              <th style={{ textAlign: 'right' }}>Antecipado</th>
              <th style={{ textAlign: 'right' }}>Taxa</th>
              <th>% efetivo</th>
              <th>Vendas</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{new Date(h.requestedAt).toLocaleString('pt-BR')}</td>
                <td>
                  <span className="ev-badge">{h.status}</span>
                </td>
                <td style={{ textAlign: 'right' }}>{formatBrl(h.originalAmountCents)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                  {h.anticipatedAmountCents != null ? formatBrl(h.anticipatedAmountCents) : '—'}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--ev-muted)' }}>
                  {formatBrl(h.feeCents)}
                </td>
                <td>{h.effectiveRatePct ?? '—'}%</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{h.salesIds?.length ?? 0} vendas</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
