/**
 * `/app/financeiro/adquirencia/regras` — DSL de match automático (Sprint 18 Faixa C).
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { acquirerReconciliationRules } from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

const ACTION_LABEL: Record<string, string> = {
  auto_match_bank: '🤖 Auto-conciliar',
  flag_for_review: '🚩 Sinalizar',
}

export default async function AcquirerRulesPage() {
  const session = await requireFullSession('/app/financeiro/adquirencia/regras')
  const tenantId = session.logifit.tenantId

  const rules = await db
    .select()
    .from(acquirerReconciliationRules)
    .where(
      and(
        eq(acquirerReconciliationRules.tenantId, tenantId),
        isNull(acquirerReconciliationRules.archivedAt),
      ),
    )
    .orderBy(asc(acquirerReconciliationRules.priority))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Regras de conciliação maquininha</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rules.length} regras ativas</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/adquirencia" className="ev-btn ev-btn-ghost">
          ← Voltar
        </Link>
        <Link href="/app/financeiro/adquirencia/regras/new" className="ev-btn ev-btn-primary">
          + Nova regra
        </Link>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0 }}>
          Regras avaliadas em ordem crescente de prioridade. A primeira que casa todas
          as condições aplica. Mantenha regras específicas com prioridade baixa
          (ex: <code>10</code>) e fallback genérico com prioridade alta (<code>900</code>).
        </p>
      </div>

      {rules.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhuma regra cadastrada. O sistema cai para sugestão manual (top-3 por
            heurística) em <code>/conciliacao</code>.
          </p>
          <Link href="/app/financeiro/adquirencia/regras/new" className="ev-btn ev-btn-primary">
            Criar primeira regra
          </Link>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Prioridade</th>
              <th>Nome</th>
              <th>Ação</th>
              <th>Condições</th>
              <th style={{ textAlign: 'right' }}>Acertos</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.priority}</td>
                <td>{r.name}</td>
                <td>
                  <span className="ev-badge">{ACTION_LABEL[r.action] ?? r.action}</span>
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
  )
}
