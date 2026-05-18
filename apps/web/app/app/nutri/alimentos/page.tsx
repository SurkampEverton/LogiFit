/**
 * `/app/nutri/alimentos` — busca + filtro do banco TACO + custom do tenant.
 *   Sprint 29 Faixa C.
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const CATEGORY_LABEL: Record<string, string> = {
  cereais_e_derivados: 'Cereais',
  verduras_hortalicas: 'Verduras / hortaliças',
  frutas: 'Frutas',
  gorduras_e_oleos: 'Gorduras / óleos',
  pescados_e_frutos_do_mar: 'Pescados',
  carnes_e_derivados: 'Carnes',
  leite_e_derivados: 'Laticínios',
  bebidas: 'Bebidas',
  ovos_e_derivados: 'Ovos',
  produtos_acucarados: 'Açucarados',
  miscelaneos: 'Diversos',
  alimentos_industrializados: 'Industrializados',
  leguminosas: 'Leguminosas',
  nozes_e_sementes: 'Nozes / sementes',
  preparacoes: 'Preparações',
}

interface PageProps {
  searchParams: Promise<{ q?: string; cat?: string }>
}

export default async function AlimentosListPage({ searchParams }: PageProps) {
  const session = await requireFullSession('/app/nutri/alimentos')
  const tenantId = session.logifit.tenantId
  const { q, cat } = await searchParams

  const rows = (
    await db.execute(sql`
      SELECT id, tenant_id, source, name, category, subcategory, nutrients
      FROM foods
      WHERE active = true
        AND (tenant_id IS NULL OR tenant_id = ${tenantId})
        ${q ? sql`AND name_normalized ILIKE ${'%' + q.toLowerCase() + '%'}` : sql``}
        ${cat ? sql`AND category::text = ${cat}` : sql``}
      ORDER BY name ASC
      LIMIT 100
    `)
  ).rows as Array<{
    id: string
    tenant_id: string | null
    source: string
    name: string
    category: string
    subcategory: string | null
    nutrients: { kcal?: number; protein_g?: number; lipid_g?: number; carbohydrate_g?: number }
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)', flexWrap: 'wrap' }}
      >
        <h1 style={{ margin: 0 }}>Alimentos</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          Catálogo TACO + custom · {rows.length} resultado{rows.length === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/nutri/alimentos/new" className="ev-btn ev-btn-primary">
          + Novo alimento
        </Link>
      </header>

      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--ev-space-sm)',
          alignItems: 'stretch',
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Buscar por nome..."
          style={{
            flex: 1,
            minWidth: 240,
            padding: 'var(--ev-space-2) var(--ev-space-3)',
            border: '1px solid var(--ev-border)',
            borderRadius: 'var(--ev-radius-md)',
            backgroundColor: 'var(--ev-surface)',
            minHeight: 44,
          }}
        />
        <select
          name="cat"
          defaultValue={cat ?? ''}
          style={{
            padding: 'var(--ev-space-2) var(--ev-space-3)',
            border: '1px solid var(--ev-border)',
            borderRadius: 'var(--ev-radius-md)',
            backgroundColor: 'var(--ev-surface)',
            minHeight: 44,
          }}
        >
          <option value="">Todas categorias</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button type="submit" className="ev-btn ev-btn-ghost">
          Buscar
        </button>
      </form>

      <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--ev-surface-muted)' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Nome</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Categoria</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Fonte</th>
              <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>kcal/100g</th>
              <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>Proteína</th>
              <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>Carbo</th>
              <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>Lipídio</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{ padding: 'var(--ev-space-md)', color: 'var(--ev-text-muted)' }}
                >
                  Nenhum alimento encontrado. Rode o seed{' '}
                  <code>pnpm db:seed:nutri-foods</code> ou cadastre via "+ Novo alimento".
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--ev-border)' }}>
                <td style={{ padding: 'var(--ev-space-2)' }}>
                  <Link href={`/app/nutri/alimentos/${r.id}`}>{r.name}</Link>
                </td>
                <td style={{ padding: 'var(--ev-space-2)', color: 'var(--ev-text-muted)' }}>
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </td>
                <td style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-xs)' }}>
                  {r.tenant_id ? '🏢 tenant' : '🌐 ' + r.source}
                </td>
                <td style={{ padding: 'var(--ev-space-2)', textAlign: 'right', fontFamily: 'monospace' }}>
                  {r.nutrients?.kcal?.toFixed(0) ?? '—'}
                </td>
                <td style={{ padding: 'var(--ev-space-2)', textAlign: 'right', fontFamily: 'monospace' }}>
                  {r.nutrients?.protein_g?.toFixed(1) ?? '—'}g
                </td>
                <td style={{ padding: 'var(--ev-space-2)', textAlign: 'right', fontFamily: 'monospace' }}>
                  {r.nutrients?.carbohydrate_g?.toFixed(1) ?? '—'}g
                </td>
                <td style={{ padding: 'var(--ev-space-2)', textAlign: 'right', fontFamily: 'monospace' }}>
                  {r.nutrients?.lipid_g?.toFixed(1) ?? '—'}g
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
