import { db } from '@repo/db/client'
/**
 * `/app/estoque/itens` — catálogo de itens (Sprint 24 Faixa C).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

function formatBrl(cents: number | null): string {
  if (cents == null) return '—'
  return (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function ItensPage() {
  const session = await requireFullSession('/app/estoque/itens')
  const tenantId = session.logifit.tenantId

  // Carrega items com saldos via subquery
  const rows = (
    await db.execute(sql`
      SELECT
        si.id,
        si.sku,
        si.name,
        si.category,
        si.unit,
        si.cost_cents,
        si.sale_price_cents,
        si.min_stock,
        si.is_resale,
        si.cost_method,
        COALESCE(
          (SELECT SUM(CASE WHEN sm.kind LIKE 'entry_%' THEN sm.quantity ELSE -sm.quantity END)
           FROM stock_movements sm WHERE sm.item_id = si.id), 0
        ) AS balance
      FROM stock_items si
      WHERE si.tenant_id = ${tenantId} AND si.archived_at IS NULL
      ORDER BY si.name
      LIMIT 500
    `)
  ).rows as Array<{
    id: string
    sku: string
    name: string
    category: string | null
    unit: string
    cost_cents: number
    sale_price_cents: number | null
    min_stock: string
    is_resale: boolean
    cost_method: string
    balance: string
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Catálogo de itens</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} SKUs</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/estoque" className="ev-btn ev-btn-ghost">
          ← Estoque
        </Link>
        <Link href="/app/estoque/itens/new" className="ev-btn ev-btn-primary">
          + Novo item
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhum item cadastrado.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nome</th>
              <th>Categoria</th>
              <th>Saldo</th>
              <th>Mínimo</th>
              <th>Custo unitário</th>
              <th>Preço venda</th>
              <th>Tipo</th>
              <th>Custo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const balance = Number(r.balance)
              const minStock = Number(r.min_stock)
              const isLow = balance <= minStock
              return (
                <tr key={r.id}>
                  <td>
                    <code>{r.sku}</code>
                  </td>
                  <td>{r.name}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{r.category ?? '—'}</td>
                  <td
                    style={{
                      fontWeight: 600,
                      color: isLow ? 'var(--ev-danger, #b91c1c)' : undefined,
                    }}
                  >
                    {balance.toFixed(3)} {r.unit}
                    {isLow && ' ⚠'}
                  </td>
                  <td>
                    {minStock.toFixed(3)} {r.unit}
                  </td>
                  <td>{formatBrl(r.cost_cents)}</td>
                  <td>{formatBrl(r.sale_price_cents)}</td>
                  <td>
                    <span className="ev-badge">{r.is_resale ? 'Revenda' : 'Consumo'}</span>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{r.cost_method}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
