/**
 * `/app/financeiro/conciliacao/regras/new` — criar reconciliation_rule (Sprint 17 Faixa C).
 */
import Link from 'next/link'
import { requireFullSession } from '../../../../../lib/session'
import { NewReconciliationRuleForm } from './new-rule-form'

export const dynamic = 'force-dynamic'

export default async function NewReconciliationRulePage() {
  await requireFullSession('/app/financeiro/conciliacao/regras/new')
  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Nova regra de conciliação</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/conciliacao/regras" className="ev-btn ev-btn-ghost">
          ← Regras
        </Link>
      </header>
      <NewReconciliationRuleForm />
    </div>
  )
}
