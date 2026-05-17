/**
 * `/app/financeiro/plano-contas/new` — formulário criação de conta contábil.
 */
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { chartOfAccounts } from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'
import { NewChartAccountForm } from './new-chart-form'

export const dynamic = 'force-dynamic'

export default async function NewChartAccountPage() {
  const session = await requireFullSession('/app/financeiro/plano-contas/new')
  const tenantId = session.logifit.tenantId

  const aggregators = await db
    .select({
      id: chartOfAccounts.id,
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
      kind: chartOfAccounts.kind,
    })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.tenantId, tenantId),
        eq(chartOfAccounts.active, true),
      ),
    )
    .orderBy(asc(chartOfAccounts.code))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Nova conta contábil</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/plano-contas" className="ev-btn ev-btn-ghost">
          ← Plano de contas
        </Link>
      </header>
      <NewChartAccountForm
        parentOptions={aggregators.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          kind: a.kind,
        }))}
      />
    </div>
  )
}
