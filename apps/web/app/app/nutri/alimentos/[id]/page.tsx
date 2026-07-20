import { db } from '@repo/db/client'
/**
 * `/app/nutri/alimentos/[id]` — detalhe nutricional + medidas caseiras.
 *   Sprint 29 Faixa C.
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function FoodDetailPage({ params }: PageProps) {
  const session = await requireFullSession('/app/nutri/alimentos')
  const tenantId = session.logifit.tenantId
  const { id } = await params

  const [food] = (
    await db.execute(sql`
      SELECT id, tenant_id, source, external_code, name, category, subcategory, preparation,
             nutrients, density_g_per_ml
      FROM foods
      WHERE id = ${id}
        AND (tenant_id IS NULL OR tenant_id = ${tenantId})
      LIMIT 1
    `)
  ).rows as Array<{
    id: string
    tenant_id: string | null
    source: string
    external_code: string | null
    name: string
    category: string
    subcategory: string | null
    preparation: string | null
    nutrients: Record<string, number>
    density_g_per_ml: string | null
  }>

  if (!food) {
    return (
      <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
        <h1>Alimento não encontrado</h1>
        <Link href="/app/nutri/alimentos">Voltar</Link>
      </div>
    )
  }

  const measures = (
    await db.execute(sql`
      SELECT measure, grams, display_order
      FROM food_measures
      WHERE food_id = ${id}
      ORDER BY display_order ASC
    `)
  ).rows as Array<{ measure: string; grams: string; display_order: number }>

  const nutrients = food.nutrients ?? {}

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
        <h1 style={{ margin: 0 }}>{food.name}</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          {food.tenant_id ? '🏢 Custom do tenant' : `🌐 ${food.source.toUpperCase()}`}
          {food.external_code ? ` · ${food.external_code}` : ''}
        </span>
      </header>

      <section
        className="ev-card"
        style={{ padding: 'var(--ev-space-md)', display: 'grid', gap: 'var(--ev-space-2)' }}
      >
        <div style={{ color: 'var(--ev-text-muted)' }}>
          {food.category}
          {food.subcategory ? ` · ${food.subcategory}` : ''}
          {food.preparation ? ` · ${food.preparation}` : ''}
        </div>
      </section>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>Composição por 100g</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {Object.entries(nutrients).map(([k, v]) => (
              <tr key={k} style={{ borderTop: '1px solid var(--ev-border)' }}>
                <td style={{ padding: 'var(--ev-space-1) 0', color: 'var(--ev-text-muted)' }}>
                  {k}
                </td>
                <td
                  style={{
                    padding: 'var(--ev-space-1) 0',
                    textAlign: 'right',
                    fontFamily: 'monospace',
                  }}
                >
                  {typeof v === 'number' ? v.toFixed(2) : String(v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {measures.length > 0 ? (
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <h2 style={{ marginTop: 0 }}>Medidas caseiras</h2>
          <ul>
            {measures.map((m) => (
              <li key={m.measure}>
                <strong>1 {m.measure}</strong> ≈ {Number(m.grams).toFixed(1)}g
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Link href="/app/nutri/alimentos" className="ev-btn ev-btn-ghost">
        ← Voltar
      </Link>
    </div>
  )
}
