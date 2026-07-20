import { db } from '@repo/db/client'
import { bankAccounts } from '@repo/db/schema'
/**
 * `/app/financeiro/adquirencia/regras/new` — criar regra de match (Sprint 18 Faixa C).
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../../lib/session'
import { NewAcquirerRuleForm } from './new-acquirer-rule-form'

export const dynamic = 'force-dynamic'

export default async function NewAcquirerRulePage() {
  const session = await requireFullSession('/app/financeiro/adquirencia/regras/new')
  const tenantId = session.logifit.tenantId

  const accounts = await db
    .select({
      id: bankAccounts.id,
      label: bankAccounts.nickname,
      bankName: bankAccounts.bankName,
    })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.tenantId, tenantId), isNull(bankAccounts.archivedAt)))
    .orderBy(asc(bankAccounts.bankName))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)', maxWidth: 720 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Nova regra de conciliação</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/adquirencia/regras" className="ev-btn ev-btn-ghost">
          ← Voltar
        </Link>
      </header>

      <NewAcquirerRuleForm
        bankAccounts={accounts.map((a) => ({
          id: a.id,
          name: a.label ?? a.bankName,
        }))}
      />
    </div>
  )
}
