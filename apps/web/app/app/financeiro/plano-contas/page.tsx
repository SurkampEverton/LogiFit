/**
 * `/app/financeiro/plano-contas` — tree view do plano de contas hierárquico
 * (Sprint 15 Faixa C, ADR 0033).
 *
 * Server-rendered. Carrega todas as contas do tenant (limite ~100), monta árvore
 * agrupada por kind (ativo/passivo/receita/despesa/custo). Cada nó mostra
 * code + name + badge folha/agregadora.
 */
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { chartOfAccounts } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const KIND_LABELS: Record<string, { label: string; color: string }> = {
  ativo: { label: 'Ativo', color: 'var(--ev-success, #16a34a)' },
  passivo: { label: 'Passivo', color: 'var(--ev-danger, #dc2626)' },
  receita: { label: 'Receita', color: 'var(--ev-info, #1e40af)' },
  despesa: { label: 'Despesa', color: 'var(--ev-warning, #92400e)' },
  custo: { label: 'Custo', color: 'var(--ev-primary, #6d28d9)' },
}

interface Row {
  id: string
  code: string
  name: string
  kind: 'ativo' | 'passivo' | 'receita' | 'despesa' | 'custo'
  parentId: string | null
  isLeaf: boolean
  active: boolean
}

export default async function PlanoContasPage() {
  const session = await requireFullSession('/app/financeiro/plano-contas')
  const tenantId = session.logifit.tenantId

  const rows = await db
    .select({
      id: chartOfAccounts.id,
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
      kind: chartOfAccounts.kind,
      parentId: chartOfAccounts.parentId,
      isLeaf: chartOfAccounts.isLeaf,
      active: chartOfAccounts.active,
    })
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.tenantId, tenantId)))
    .orderBy(asc(chartOfAccounts.code))

  // Agrupa por kind
  const byKind: Record<string, Row[]> = {
    ativo: [],
    passivo: [],
    receita: [],
    despesa: [],
    custo: [],
  }
  for (const r of rows as Row[]) {
    byKind[r.kind]?.push(r)
  }

  // Total folhas
  const totalFolhas = (rows as Row[]).filter((r) => r.isLeaf).length

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Plano de Contas</h1>
        <span style={{ color: 'var(--ev-muted)' }}>
          {rows.length} contas ({totalFolhas} folhas)
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
        <Link href="/app/financeiro/plano-contas/new" className="ev-btn ev-btn-primary">
          + Nova conta
        </Link>
      </header>

      {rows.length === 0 && (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhuma conta cadastrada. Execute <code>pnpm --filter @repo/db db:seed:plano-contas</code> para
            popular o plano brasileiro simplificado, ou crie manualmente.
          </p>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        {Object.entries(byKind).map(([kind, list]) => {
          if (list.length === 0) return null
          const meta = KIND_LABELS[kind]!
          return (
            <section key={kind} className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
              <header
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--ev-space-sm)',
                  marginBottom: 'var(--ev-space-sm)',
                }}
              >
                <span
                  className="ev-dot"
                  style={{ backgroundColor: meta.color, width: 12, height: 12 }}
                />
                <h2 style={{ margin: 0, fontSize: 'var(--ev-font-md)' }}>{meta.label}</h2>
                <span style={{ flex: 1 }} />
                <span style={{ color: 'var(--ev-muted)', fontSize: 'var(--ev-font-sm)' }}>
                  {list.length}
                </span>
              </header>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {list.map((acc) => {
                  const depth = (acc.code.match(/\./g) ?? []).length
                  return (
                    <li
                      key={acc.id}
                      style={{
                        paddingLeft: depth * 12,
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        fontSize: 'var(--ev-font-sm)',
                        opacity: acc.active ? 1 : 0.55,
                      }}
                    >
                      <code
                        style={{
                          fontSize: 'var(--ev-font-xs)',
                          color: 'var(--ev-muted)',
                          minWidth: 56,
                        }}
                      >
                        {acc.code}
                      </code>
                      <span style={{ fontWeight: acc.isLeaf ? 400 : 600 }}>{acc.name}</span>
                      {!acc.isLeaf && (
                        <span
                          className="ev-badge"
                          style={{
                            fontSize: 'var(--ev-font-xs)',
                            backgroundColor: 'var(--ev-muted-bg)',
                            color: 'var(--ev-muted)',
                          }}
                        >
                          grupo
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
