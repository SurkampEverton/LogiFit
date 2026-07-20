import { db } from '@repo/db/client'
import { companies, persons } from '@repo/db/schema'
/**
 * `/app/financeiro/rateio/regras/new` — criar allocation_rule (Sprint 16 Faixa C).
 */
import { asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../../lib/session'
import { NewAllocationRuleForm } from './new-allocation-rule-form'

export const dynamic = 'force-dynamic'

export default async function NewAllocationRulePage() {
  const session = await requireFullSession('/app/financeiro/rateio/regras/new')
  const tenantId = session.logifit.tenantId

  const companiesList = await db
    .select({ id: companies.id, name: persons.name, type: companies.type })
    .from(companies)
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(eq(companies.tenantId, tenantId))
    .orderBy(asc(persons.name))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Nova regra de rateio</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/rateio/regras" className="ev-btn ev-btn-ghost">
          ← Regras
        </Link>
      </header>

      {companiesList.length < 2 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p>
            Rateio precisa de pelo menos 2 companies no tenant. Atualmente: {companiesList.length}{' '}
            company(s).
          </p>
        </div>
      ) : (
        <NewAllocationRuleForm
          companies={companiesList.map((c) => ({
            id: c.id,
            name: c.name ?? '(sem nome)',
            type: c.type,
          }))}
        />
      )}
    </div>
  )
}
