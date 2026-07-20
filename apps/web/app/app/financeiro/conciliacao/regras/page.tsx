import { db } from '@repo/db/client'
import { reconciliationRules } from '@repo/db/schema'
/**
 * `/app/financeiro/conciliacao/regras` — lista reconciliation_rules (Sprint 17 Faixa C).
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

const ACTION_LABELS: Record<string, string> = {
  auto_match_ap: 'Auto-match AP',
  auto_match_ar: 'Auto-match AR',
  auto_create_entry: 'Auto-criar cost entry',
  flag_for_review: 'Sinalizar pra revisão',
}

export default async function ReconciliationRulesPage() {
  const session = await requireFullSession('/app/financeiro/conciliacao/regras')
  const tenantId = session.logifit.tenantId

  const rows = await db
    .select({
      id: reconciliationRules.id,
      name: reconciliationRules.name,
      condition: reconciliationRules.condition,
      action: reconciliationRules.action,
      priority: reconciliationRules.priority,
      active: reconciliationRules.active,
      hitsCount: reconciliationRules.hitsCount,
    })
    .from(reconciliationRules)
    .where(and(eq(reconciliationRules.tenantId, tenantId), isNull(reconciliationRules.archivedAt)))
    .orderBy(asc(reconciliationRules.priority))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Regras de conciliação</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} ativas</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/bancos" className="ev-btn ev-btn-ghost">
          ← Bancos
        </Link>
        <Link href="/app/financeiro/conciliacao/regras/new" className="ev-btn ev-btn-primary">
          + Nova regra
        </Link>
      </header>

      <p style={{ color: 'var(--ev-muted)', marginTop: 0 }}>
        Regras casam transações com AP/AR automaticamente baseado em descrição, valor e data.
        Aplicadas em ordem de prioridade (menor número = mais específica).
      </p>

      {rows.length === 0 && (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhuma regra cadastrada. Cadastre a primeira para automatizar conciliação.
          </p>
          <Link href="/app/financeiro/conciliacao/regras/new" className="ev-btn ev-btn-primary">
            Criar regra
          </Link>
        </div>
      )}

      <div className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length > 0 && (
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', width: 60 }}>Prio</th>
                <th style={{ textAlign: 'left' }}>Nome</th>
                <th style={{ textAlign: 'left' }}>Ação</th>
                <th style={{ textAlign: 'left' }}>Condição</th>
                <th style={{ textAlign: 'right' }}>Hits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontFamily: 'monospace' }}>{r.priority}</td>
                  <td>{r.name}</td>
                  <td>
                    <span className="ev-badge">{ACTION_LABELS[r.action] ?? r.action}</span>
                  </td>
                  <td>
                    <code style={{ fontSize: 'var(--ev-font-xs)' }}>
                      {JSON.stringify(r.condition)}
                    </code>
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.hitsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
