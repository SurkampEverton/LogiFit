import { db } from '@repo/db/client'
/**
 * `/app/nutri/exames` — catálogo de analitos laboratoriais.
 *   Sprint 30 Faixa C.
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const CATEGORY_LABEL: Record<string, string> = {
  bioquimico: 'Bioquímico',
  hematologico: 'Hematológico',
  hormonal: 'Hormonal',
  lipidograma: 'Lipidograma',
  vitamina_mineral: 'Vitaminas / Minerais',
  inflamatorio: 'Inflamatório',
  metabolismo_oxidativo: 'Metabolismo oxidativo',
  imunologico: 'Imunológico',
  urina: 'Urina',
  fezes: 'Fezes',
  outro: 'Outros',
}

interface PageProps {
  searchParams: Promise<{ cat?: string }>
}

export default async function ExamesCatalogoPage({ searchParams }: PageProps) {
  await requireFullSession('/app/nutri/exames')
  const { cat } = await searchParams

  const rows = (
    await db.execute(sql`
      SELECT id, code, name, category, unit, description,
             (SELECT count(*)::int FROM lab_reference_ranges WHERE analyte_id = lab_analytes.id) AS ranges_count
      FROM lab_analytes
      WHERE active = true
        ${cat ? sql`AND category::text = ${cat}` : sql``}
      ORDER BY category, name
      LIMIT 200
    `)
  ).rows as Array<{
    id: string
    code: string
    name: string
    category: string
    unit: string
    description: string | null
    ranges_count: number
  }>

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
        <h1 style={{ margin: 0 }}>Catálogo de exames</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          {rows.length} analito{rows.length === 1 ? '' : 's'}
        </span>
      </header>

      <nav style={{ display: 'flex', gap: 'var(--ev-space-sm)', flexWrap: 'wrap' }}>
        <Link
          href="/app/nutri/exames"
          className="ev-btn ev-btn-ghost"
          style={{ fontWeight: !cat ? 600 : 400 }}
        >
          Todas
        </Link>
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
          <Link
            key={k}
            href={`/app/nutri/exames?cat=${k}`}
            className="ev-btn ev-btn-ghost"
            style={{ fontWeight: cat === k ? 600 : 400 }}
          >
            {v}
          </Link>
        ))}
      </nav>

      <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--ev-surface-muted)' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Analito</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Code</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Categoria</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Unidade</th>
              <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>Faixas</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{ padding: 'var(--ev-space-md)', color: 'var(--ev-text-muted)' }}
                >
                  Nenhum analito. Rode <code>pnpm db:seed:nutri-labs</code>.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--ev-border)' }}>
                <td style={{ padding: 'var(--ev-space-2)' }}>{r.name}</td>
                <td
                  style={{
                    padding: 'var(--ev-space-2)',
                    fontFamily: 'monospace',
                    fontSize: 'var(--ev-text-xs)',
                  }}
                >
                  {r.code}
                </td>
                <td style={{ padding: 'var(--ev-space-2)', color: 'var(--ev-text-muted)' }}>
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </td>
                <td style={{ padding: 'var(--ev-space-2)' }}>{r.unit}</td>
                <td style={{ padding: 'var(--ev-space-2)', textAlign: 'right' }}>
                  {r.ranges_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
