import { db } from '@repo/db/client'
import { companies, persons } from '@repo/db/schema'
/**
 * `/app/financeiro/intercompany/new` — criar IC entry (Sprint 16 Faixa C).
 */
import { asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { NewICForm } from './new-ic-form'

export const dynamic = 'force-dynamic'

export default async function NewICPage() {
  const session = await requireFullSession('/app/financeiro/intercompany/new')
  const tenantId = session.logifit.tenantId

  const companyList = await db
    .select({
      id: companies.id,
      name: persons.name,
      personId: companies.personId,
      type: companies.type,
    })
    .from(companies)
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(eq(companies.tenantId, tenantId))
    .orderBy(asc(persons.name))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Novo lançamento Intercompany</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/intercompany" className="ev-btn ev-btn-ghost">
          ← Intercompany
        </Link>
      </header>

      {companyList.length < 2 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p>Precisa de ao menos 2 companies para IC. Atualmente: {companyList.length}.</p>
        </div>
      ) : (
        <NewICForm
          companies={companyList.map((c) => ({
            id: c.id,
            name: c.name ?? '(sem nome)',
            personId: c.personId,
            type: c.type,
          }))}
        />
      )}
    </div>
  )
}
