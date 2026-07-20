import { db } from '@repo/db/client'
import { acquirerConnections, acquirerSales, companies, persons } from '@repo/db/schema'
/**
 * `/app/financeiro/adquirencia` — lista de maquininhas conectadas (Sprint 18 Faixa C).
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const PROVIDER_LABEL: Record<string, string> = {
  cielo: 'Cielo',
  stone: 'Stone',
  rede: 'Rede',
  getnet: 'GetNet',
  pagseguro: 'PagSeguro',
  mock: 'Mock (sandbox)',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  active: 'Ativa',
  error: 'Erro',
  revoked: 'Revogada',
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function AdquirenciaListPage() {
  const session = await requireFullSession('/app/financeiro/adquirencia')
  const tenantId = session.logifit.tenantId

  const conns = await db
    .select({
      id: acquirerConnections.id,
      provider: acquirerConnections.provider,
      merchantId: acquirerConnections.merchantId,
      nickname: acquirerConnections.nickname,
      sandbox: acquirerConnections.sandbox,
      status: acquirerConnections.status,
      lastSyncedAt: acquirerConnections.lastSyncedAt,
      lastSyncError: acquirerConnections.lastSyncError,
      companyName: persons.name,
    })
    .from(acquirerConnections)
    .leftJoin(companies, eq(companies.id, acquirerConnections.companyId))
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(and(eq(acquirerConnections.tenantId, tenantId), isNull(acquirerConnections.archivedAt)))
    .orderBy(asc(acquirerConnections.provider))

  // Agregados por connection (vendas últimos 30d)
  const last30d = new Date()
  last30d.setDate(last30d.getDate() - 30)
  const agg = await db
    .select({
      connectionId: acquirerSales.connectionId,
      count: sql<number>`COUNT(*)::int`,
      grossCents: sql<number>`COALESCE(SUM(${acquirerSales.grossAmountCents}), 0)::bigint`,
      netCents: sql<number>`COALESCE(SUM(${acquirerSales.netAmountCents}), 0)::bigint`,
    })
    .from(acquirerSales)
    .where(
      and(
        eq(acquirerSales.tenantId, tenantId),
        sql`${acquirerSales.capturedAt} >= ${last30d}`,
        sql`${acquirerSales.status} NOT IN ('cancelled', 'chargeback')`,
      ),
    )
    .groupBy(acquirerSales.connectionId)
  const aggByConn = new Map(agg.map((a) => [a.connectionId, a]))

  const totalGross = agg.reduce((s, a) => s + Number(a.grossCents), 0)
  const totalNet = agg.reduce((s, a) => s + Number(a.netCents), 0)

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
        <h1 style={{ margin: 0 }}>Adquirência</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{conns.length} maquininha(s)</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/receita" className="ev-btn ev-btn-ghost">
          📊 Receita unificada
        </Link>
        <Link href="/app/financeiro/adquirencia/conciliacao" className="ev-btn ev-btn-ghost">
          🔁 Conciliação
        </Link>
        <Link href="/app/financeiro/adquirencia/regras" className="ev-btn ev-btn-ghost">
          ⚙️ Regras
        </Link>
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
        <Link href="/app/financeiro/adquirencia/new" className="ev-btn ev-btn-primary">
          + Nova maquininha
        </Link>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Receita bruta 30d
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(totalGross)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Receita líquida 30d
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(totalNet)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Custo total taxas
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-danger, #b91c1c)',
            }}
          >
            {formatBrl(totalGross - totalNet)}
          </div>
        </div>
      </section>

      {conns.length === 0 && (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhuma maquininha conectada. Adicione Cielo / Stone / Rede / GetNet / PagSeguro para
            sincronizar vendas presenciais com o financeiro.
          </p>
          <p style={{ color: 'var(--ev-muted)' }}>
            <strong>MVP:</strong> use o provider <code>mock</code> com sandbox=true para testar o
            fluxo completo (vendas determinísticas geradas localmente). Adapters reais chegam no
            Sprint 18b quando houver credentials sandbox.
          </p>
          <Link href="/app/financeiro/adquirencia/new" className="ev-btn ev-btn-primary">
            Adicionar maquininha
          </Link>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        {conns.map((c) => {
          const a = aggByConn.get(c.id)
          return (
            <Link
              key={c.id}
              href={`/app/financeiro/adquirencia/${c.id}/vendas`}
              className="ev-card"
              style={{
                padding: 'var(--ev-space-md)',
                textDecoration: 'none',
                color: 'inherit',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <strong>{c.nickname ?? PROVIDER_LABEL[c.provider]}</strong>
                <span style={{ flex: 1 }} />
                {c.sandbox && <span className="ev-badge">Sandbox</span>}
                <span
                  className="ev-badge"
                  style={{
                    background:
                      c.status === 'active'
                        ? 'var(--ev-success-soft, #dcfce7)'
                        : c.status === 'error'
                          ? 'var(--ev-danger-soft, #fee2e2)'
                          : 'var(--ev-surface)',
                  }}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </div>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                {PROVIDER_LABEL[c.provider]} · merchant {c.merchantId}
              </div>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                {c.companyName ?? '—'}
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 4,
                }}
              >
                <div>
                  <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                    Vendas 30d
                  </div>
                  <div style={{ fontSize: 'var(--ev-font-md)', fontWeight: 600 }}>
                    {a?.count ?? 0}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                    Líquido 30d
                  </div>
                  <div style={{ fontSize: 'var(--ev-font-md)', fontWeight: 600 }}>
                    {formatBrl(Number(a?.netCents ?? 0))}
                  </div>
                </div>
              </div>
              <div
                style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)', marginTop: 4 }}
              >
                {c.lastSyncedAt
                  ? `Sync ${new Date(c.lastSyncedAt).toLocaleString('pt-BR')}`
                  : 'Nunca sincronizado — clique pra rodar 1ª sync'}
              </div>
              {c.lastSyncError && (
                <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-danger, #b91c1c)' }}>
                  ⚠ {c.lastSyncError}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
