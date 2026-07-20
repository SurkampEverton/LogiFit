import { db } from '@repo/db/client'
import { acquirerConnections, acquirerSales } from '@repo/db/schema'
/**
 * `/app/financeiro/adquirencia/conciliacao` — conciliação venda↔bank_tx (Sprint 18 Faixa C).
 *
 * Lista vendas pendentes (status settled/anticipated sem reconciledAt) e oferece
 * "Buscar sugestões" → top-3 bank_transactions com score color-coded.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { ReconciliacaoList } from './reconciliacao-list'

export const dynamic = 'force-dynamic'

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function ConciliacaoAdquirenciaPage() {
  const session = await requireFullSession('/app/financeiro/adquirencia/conciliacao')
  const tenantId = session.logifit.tenantId

  const pending = await db
    .select({
      id: acquirerSales.id,
      connectionId: acquirerSales.connectionId,
      externalId: acquirerSales.externalId,
      capturedAt: acquirerSales.capturedAt,
      netAmountCents: acquirerSales.netAmountCents,
      cardBrand: acquirerSales.cardBrand,
      cardKind: acquirerSales.cardKind,
      expectedSettlementDate: acquirerSales.expectedSettlementDate,
      status: acquirerSales.status,
      provider: acquirerConnections.provider,
      nickname: acquirerConnections.nickname,
    })
    .from(acquirerSales)
    .leftJoin(acquirerConnections, eq(acquirerConnections.id, acquirerSales.connectionId))
    .where(
      and(
        eq(acquirerSales.tenantId, tenantId),
        isNull(acquirerSales.reconciledAt),
        sql`${acquirerSales.status} IN ('settled', 'anticipated')`,
      ),
    )
    .orderBy(asc(acquirerSales.expectedSettlementDate))
    .limit(100)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Conciliação maquininha ↔ banco</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{pending.length} vendas pendentes</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/adquirencia/regras" className="ev-btn ev-btn-ghost">
          ⚙️ Regras
        </Link>
        <Link href="/app/financeiro/adquirencia" className="ev-btn ev-btn-ghost">
          ← Voltar
        </Link>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0 }}>
          Para cada venda settled/anticipated, busca extratos bancários (positivos) em ± 7 dias do
          settlement esperado e mostra top-3 candidatos com score (peso 55% valor + 35% data + 10%
          descrição). Verde &gt;90%, azul &gt;70%, amarelo &gt;50%.
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Sem vendas pendentes de conciliação. ✓</p>
        </div>
      ) : (
        <ReconciliacaoList
          sales={pending.map((s) => ({
            id: s.id,
            externalId: s.externalId,
            provider: s.provider ?? 'mock',
            connectionNickname: s.nickname ?? '—',
            capturedAt: s.capturedAt.toISOString(),
            netAmountCents: s.netAmountCents,
            cardBrand: s.cardBrand ?? '—',
            cardKind: s.cardKind,
            expectedSettlementDate: s.expectedSettlementDate,
            status: s.status,
            display: `${formatBrl(s.netAmountCents)} · ${s.cardBrand ?? '—'}`,
          }))}
        />
      )}
    </div>
  )
}
