import { db } from '@repo/db/client'
import { cifCatalog } from '@repo/db/schema'
/**
 * `/app/catalogos/cif` — visão read-only CIF (Sprint 20 Faixa C).
 */
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const COMPONENT_LABEL: Record<string, string> = {
  body_functions: 'b — Funções',
  body_structures: 's — Estruturas',
  activities_participation: 'd — Atividades e Participação',
  environmental_factors: 'e — Fatores Ambientais',
}

export default async function CifCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; component?: string }>
}) {
  await requireFullSession('/app/catalogos/cif')
  const params = await searchParams
  const q = params.q ?? ''
  const component = params.component ?? ''

  const conds = [eq(cifCatalog.active, true)]
  if (q) conds.push(or(ilike(cifCatalog.code, `%${q}%`), ilike(cifCatalog.description, `%${q}%`))!)
  if (component) conds.push(eq(cifCatalog.component, component as 'body_functions'))

  const rows = await db
    .select()
    .from(cifCatalog)
    .where(and(...conds))
    .orderBy(asc(cifCatalog.code))
    .limit(200)
  const countResult = (
    await db.execute(sql`SELECT COUNT(*)::int AS count FROM cif_catalog WHERE active = true`)
  ).rows as Array<{ count: number }>
  const count = countResult[0]?.count ?? 0

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>CIF</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{count} ativos</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/catalogos/cid" className="ev-btn ev-btn-ghost">
          ← CID
        </Link>
      </header>

      <form method="get" style={{ display: 'flex', gap: 8 }}>
        <input
          className="ev-input"
          name="q"
          defaultValue={q}
          placeholder="Buscar"
          style={{ flex: 1 }}
        />
        <select className="ev-input" name="component" defaultValue={component}>
          <option value="">Todos componentes</option>
          {Object.entries(COMPONENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button type="submit" className="ev-btn ev-btn-primary">
          Buscar
        </button>
      </form>

      <table className="ev-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Código</th>
            <th>Componente</th>
            <th>Descrição</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.code}>
              <td>
                <code>{c.code}</code>
              </td>
              <td style={{ fontSize: 'var(--ev-font-xs)' }}>{COMPONENT_LABEL[c.component]}</td>
              <td>{c.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
