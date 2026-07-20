import { db } from '@repo/db/client'
import { acquirerConnections, acquirerSales, companies, persons } from '@repo/db/schema'
/**
 * `/app/financeiro/adquirencia/[id]/vendas` — extrato de vendas + sync (Sprint 18 Faixa C).
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../../lib/session'
import { SyncSalesButton } from './sync-sales-button'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, { label: string; bg: string }> = {
  captured: { label: 'Capturada', bg: 'var(--ev-surface)' },
  settled: { label: 'Liquidada', bg: 'var(--ev-success-soft, #dcfce7)' },
  anticipated: { label: 'Antecipada', bg: 'var(--ev-info-soft, #eff6ff)' },
  chargeback: { label: 'Chargeback', bg: 'var(--ev-danger-soft, #fee2e2)' },
  cancelled: { label: 'Cancelada', bg: 'var(--ev-muted-soft, #f3f4f6)' },
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function ConnectionSalesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/financeiro/adquirencia/${id}/vendas`)
  const tenantId = session.logifit.tenantId

  const [conn] = await db
    .select({
      id: acquirerConnections.id,
      provider: acquirerConnections.provider,
      merchantId: acquirerConnections.merchantId,
      nickname: acquirerConnections.nickname,
      sandbox: acquirerConnections.sandbox,
      status: acquirerConnections.status,
      lastSyncedAt: acquirerConnections.lastSyncedAt,
      companyName: persons.name,
    })
    .from(acquirerConnections)
    .leftJoin(companies, eq(companies.id, acquirerConnections.companyId))
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(and(eq(acquirerConnections.id, id), eq(acquirerConnections.tenantId, tenantId)))
    .limit(1)

  if (!conn) notFound()

  const sales = await db
    .select({
      id: acquirerSales.id,
      externalId: acquirerSales.externalId,
      capturedAt: acquirerSales.capturedAt,
      grossAmountCents: acquirerSales.grossAmountCents,
      feeCents: acquirerSales.feeCents,
      netAmountCents: acquirerSales.netAmountCents,
      anticipatedAmountCents: acquirerSales.anticipatedAmountCents,
      cardBrand: acquirerSales.cardBrand,
      cardKind: acquirerSales.cardKind,
      installments: acquirerSales.installments,
      expectedSettlementDate: acquirerSales.expectedSettlementDate,
      actualSettlementDate: acquirerSales.actualSettlementDate,
      status: acquirerSales.status,
      reconciledAt: acquirerSales.reconciledAt,
    })
    .from(acquirerSales)
    .where(and(eq(acquirerSales.connectionId, id), eq(acquirerSales.tenantId, tenantId)))
    .orderBy(desc(acquirerSales.capturedAt))
    .limit(200)

  const [agg] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      grossCents: sql<number>`COALESCE(SUM(${acquirerSales.grossAmountCents}), 0)::bigint`,
      netCents: sql<number>`COALESCE(SUM(${acquirerSales.netAmountCents}), 0)::bigint`,
      pending: sql<number>`SUM(CASE WHEN ${acquirerSales.reconciledAt} IS NULL AND ${acquirerSales.status} IN ('settled','anticipated') THEN 1 ELSE 0 END)::int`,
    })
    .from(acquirerSales)
    .where(and(eq(acquirerSales.connectionId, id), eq(acquirerSales.tenantId, tenantId)))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-md)',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0 }}>{conn.nickname ?? `${conn.provider} ${conn.merchantId}`}</h1>
        <span className="ev-badge">{conn.provider}</span>
        {conn.sandbox && <span className="ev-badge">Sandbox</span>}
        <span style={{ flex: 1 }} />
        <Link
          href={`/app/financeiro/adquirencia/${id}/antecipacao`}
          className="ev-btn ev-btn-ghost"
        >
          ⚡ Antecipação
        </Link>
        <SyncSalesButton connectionId={id} />
        <Link href="/app/financeiro/adquirencia" className="ev-btn ev-btn-ghost">
          ← Voltar
        </Link>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Total vendas
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{agg?.total ?? 0}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Bruto</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(Number(agg?.grossCents ?? 0))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Líquido</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(Number(agg?.netCents ?? 0))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>A conciliar</div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: (agg?.pending ?? 0) > 0 ? 'var(--ev-warning, #ca8a04)' : undefined,
            }}
          >
            {agg?.pending ?? 0}
          </div>
        </div>
      </section>

      {sales.length === 0 && (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhuma venda sincronizada. Clique em "Sincronizar agora" para puxar vendas do provider
            (mock gera 3 vendas/dia determinísticas pelo intervalo).
          </p>
        </div>
      )}

      {sales.length > 0 && (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Data</th>
              <th>Bandeira/Tipo</th>
              <th>Parcelas</th>
              <th style={{ textAlign: 'right' }}>Bruto</th>
              <th style={{ textAlign: 'right' }}>Taxa</th>
              <th style={{ textAlign: 'right' }}>Líquido</th>
              <th>Settlement</th>
              <th>Status</th>
              <th>Conciliação</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => {
              const badge = STATUS_BADGE[s.status] ?? { label: s.status, bg: 'var(--ev-surface)' }
              return (
                <tr key={s.id}>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(s.capturedAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td>
                    {s.cardBrand ?? '—'} / {s.cardKind}
                  </td>
                  <td>{s.installments}x</td>
                  <td style={{ textAlign: 'right' }}>{formatBrl(s.grossAmountCents)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ev-muted)' }}>
                    {formatBrl(s.feeCents)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatBrl(s.netAmountCents)}
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {s.expectedSettlementDate}
                    {s.actualSettlementDate && (
                      <>
                        {' '}
                        → <strong>{s.actualSettlementDate}</strong>
                      </>
                    )}
                  </td>
                  <td>
                    <span className="ev-badge" style={{ background: badge.bg }}>
                      {badge.label}
                    </span>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {s.reconciledAt ? (
                      <span style={{ color: 'var(--ev-success, #16a34a)' }}>✓ Conciliada</span>
                    ) : (
                      <Link href="/app/financeiro/adquirencia/conciliacao">Conciliar</Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
