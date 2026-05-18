/**
 * `/app/nutri/suplementos` — catálogo (Sprint 30 Faixa C).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  vitamin: 'Vitamina',
  mineral: 'Mineral',
  fitoterapico: 'Fitoterápico',
  aminoacid: 'Aminoácido',
  protein_powder: 'Proteína em pó',
  blend: 'Blend',
  omega: 'Ômega',
  probiotic: 'Probiótico',
  enzyme: 'Enzima',
  pre_workout: 'Pré-treino',
  other: 'Outros',
}

interface PageProps {
  searchParams: Promise<{ q?: string; kind?: string }>
}

export default async function SuplementosListPage({ searchParams }: PageProps) {
  const session = await requireFullSession('/app/nutri/suplementos')
  const tenantId = session.logifit.tenantId
  const { q, kind } = await searchParams

  const rows = (
    await db.execute(sql`
      SELECT id, tenant_id, name, kind, brand, concentration, anvisa_registration, indication
      FROM supplements
      WHERE active = true
        AND (tenant_id IS NULL OR tenant_id = ${tenantId})
        ${q ? sql`AND name_normalized ILIKE ${'%' + q.toLowerCase() + '%'}` : sql``}
        ${kind ? sql`AND kind::text = ${kind}` : sql``}
      ORDER BY name ASC
      LIMIT 100
    `)
  ).rows as Array<{
    id: string
    tenant_id: string | null
    name: string
    kind: string
    brand: string | null
    concentration: string | null
    anvisa_registration: string | null
    indication: string | null
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)', flexWrap: 'wrap' }}
      >
        <h1 style={{ margin: 0 }}>Suplementação</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          Sprint 30 · ADR 0082 · {rows.length} suplemento{rows.length === 1 ? '' : 's'}
        </span>
      </header>

      <form
        method="get"
        style={{ display: 'flex', gap: 'var(--ev-space-sm)', flexWrap: 'wrap' }}
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
          name="kind"
          defaultValue={kind ?? ''}
          style={{
            padding: 'var(--ev-space-2) var(--ev-space-3)',
            border: '1px solid var(--ev-border)',
            borderRadius: 'var(--ev-radius-md)',
            backgroundColor: 'var(--ev-surface)',
            minHeight: 44,
          }}
        >
          <option value="">Todos tipos</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
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
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Tipo</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Concentração</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>ANVISA</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Fonte</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 'var(--ev-space-md)', color: 'var(--ev-text-muted)' }}>
                  Nenhum suplemento. Rode <code>pnpm db:seed:nutri-labs</code>.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--ev-border)' }}>
                <td style={{ padding: 'var(--ev-space-2)' }}>
                  <Link href={`/app/nutri/suplementos/${r.id}`}>{r.name}</Link>
                  {r.brand ? (
                    <small style={{ color: 'var(--ev-text-muted)' }}> · {r.brand}</small>
                  ) : null}
                </td>
                <td style={{ padding: 'var(--ev-space-2)', color: 'var(--ev-text-muted)' }}>
                  {KIND_LABEL[r.kind] ?? r.kind}
                </td>
                <td style={{ padding: 'var(--ev-space-2)' }}>{r.concentration ?? '—'}</td>
                <td style={{ padding: 'var(--ev-space-2)', fontFamily: 'monospace', fontSize: 'var(--ev-text-xs)' }}>
                  {r.anvisa_registration ?? '—'}
                </td>
                <td style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-xs)' }}>
                  {r.tenant_id ? '🏢 tenant' : '🌐 global'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
