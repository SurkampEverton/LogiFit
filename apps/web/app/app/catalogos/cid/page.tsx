/**
 * `/app/catalogos/cid` — visão read-only do catálogo CID-11 (Sprint 20 Faixa C).
 */
import { asc, eq, ilike, or, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { cidCatalog } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function CidCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requireFullSession('/app/catalogos/cid')
  const params = await searchParams
  const q = params.q ?? ''

  const where = q
    ? or(
        ilike(cidCatalog.code, `%${q.toUpperCase()}%`),
        ilike(cidCatalog.description, `%${q}%`),
      )!
    : eq(cidCatalog.active, true)

  const rows = await db.select().from(cidCatalog).where(where).orderBy(asc(cidCatalog.code)).limit(200)
  const countResult = (
    await db.execute(sql`SELECT COUNT(*)::int AS count FROM cid_catalog WHERE active = true`)
  ).rows as Array<{ count: number }>
  const count = countResult[0]?.count ?? 0

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>CID-11</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{count} ativos globalmente</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/catalogos/cif" className="ev-btn ev-btn-ghost">
          → CIF
        </Link>
      </header>

      <form method="get" style={{ display: 'flex', gap: 8 }}>
        <input
          className="ev-input"
          name="q"
          defaultValue={q}
          placeholder="Buscar por código (MG30.0) ou descrição"
          style={{ flex: 1 }}
        />
        <button type="submit" className="ev-btn ev-btn-primary">
          Buscar
        </button>
      </form>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0, marginBottom: 0 }}>
          Catálogo CID-11 (WHO) curado pela LogiFit. Read-only — update via release
          anual. Vincule códigos em <code>/app/fisio/consultas/[id]</code>.
        </p>
      </div>

      <table className="ev-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Código</th>
            <th>Capítulo</th>
            <th>Descrição</th>
            <th>Versão</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.code}>
              <td>
                <code>{c.code}</code>
              </td>
              <td style={{ fontSize: 'var(--ev-font-xs)' }}>{c.chapter ?? '—'}</td>
              <td>{c.description}</td>
              <td style={{ fontSize: 'var(--ev-font-xs)' }}>{c.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
