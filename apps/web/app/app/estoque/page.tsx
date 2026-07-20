import { db } from '@repo/db/client'
/**
 * `/app/estoque` — hub estoque (Sprint 24 Faixa C).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

function formatBrl(cents: number): string {
  return (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function EstoqueHubPage() {
  const session = await requireFullSession('/app/estoque')
  const tenantId = session.logifit.tenantId

  const [k] = (
    await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM stock_items WHERE tenant_id = ${tenantId} AND active = true) AS total_items,
        (SELECT COUNT(*)::int FROM stock_items si WHERE si.tenant_id = ${tenantId} AND si.active = true AND si.is_resale = true) AS resale_items,
        (SELECT COUNT(*)::int FROM stock_movements WHERE tenant_id = ${tenantId} AND at > NOW() - INTERVAL '30 days') AS movements_30d,
        (SELECT COUNT(*)::int FROM (
          SELECT si.id, COALESCE(SUM(CASE WHEN sm.kind LIKE 'entry_%' THEN sm.quantity ELSE -sm.quantity END), 0) AS bal
          FROM stock_items si LEFT JOIN stock_movements sm ON sm.item_id = si.id
          WHERE si.tenant_id = ${tenantId} AND si.active = true
          GROUP BY si.id, si.min_stock HAVING COALESCE(SUM(CASE WHEN sm.kind LIKE 'entry_%' THEN sm.quantity ELSE -sm.quantity END), 0) <= si.min_stock
        ) low) AS low_stock_count,
        (SELECT COALESCE(SUM(si.cost_cents *
          GREATEST(0, COALESCE((SELECT SUM(CASE WHEN sm.kind LIKE 'entry_%' THEN sm.quantity ELSE -sm.quantity END) FROM stock_movements sm WHERE sm.item_id = si.id), 0))
        ), 0)::bigint FROM stock_items si WHERE si.tenant_id = ${tenantId} AND si.active = true) AS inventory_value
    `)
  ).rows as Array<{
    total_items: number
    resale_items: number
    movements_30d: number
    low_stock_count: number
    inventory_value: number
  }>
  const kpi = k ?? {
    total_items: 0,
    resale_items: 0,
    movements_30d: 0,
    low_stock_count: 0,
    inventory_value: 0,
  }

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Estoque + POS</h1>
        <span style={{ color: 'var(--ev-muted)' }}>Sprint 24a · ADR 0087 Proposed</span>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>SKUs ativos</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{kpi.total_items}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Revenda</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{kpi.resale_items}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Movimentos 30d
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{kpi.movements_30d}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Estoque crítico
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: kpi.low_stock_count > 0 ? 'var(--ev-danger, #b91c1c)' : undefined,
            }}
          >
            {kpi.low_stock_count}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Valor estoque
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(Number(kpi.inventory_value))}
          </div>
        </div>
      </section>

      <nav
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <Link
          href="/app/estoque/itens"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>📦 Itens</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Catálogo SKU + saldos + cadastro
          </div>
        </Link>
        <Link
          href="/app/estoque/entradas"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>📥 Entradas</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Compra / ajuste pra mais
          </div>
        </Link>
        <Link
          href="/app/estoque/saidas"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>📤 Saídas</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Consumo / perda / ajuste pra menos
          </div>
        </Link>
        <Link
          href="/app/estoque/vendas"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>🛒 POS Vendas</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Venda balcão (itens resale)
          </div>
        </Link>
        <Link
          href="/app/estoque/inventario"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>📋 Inventário</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Contagem física + ajustes
          </div>
        </Link>
        <Link
          href="/app/estoque/relatorios"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>📊 Relatórios</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Estoque crítico + giro + parados
          </div>
        </Link>
      </nav>
    </div>
  )
}
