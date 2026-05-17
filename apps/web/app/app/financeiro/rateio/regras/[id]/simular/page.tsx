/**
 * `/app/financeiro/rateio/regras/[id]/simular` — simulador de rateio (Sprint 16 Faixa C).
 */
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@repo/db/client'
import { allocationRules, companies, persons } from '@repo/db/schema'
import { requireFullSession } from '../../../../../../lib/session'
import { SimulatorForm } from './simulator-form'

export const dynamic = 'force-dynamic'

export default async function SimulatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/financeiro/rateio/regras/${id}/simular`)
  const tenantId = session.logifit.tenantId

  const [rule] = await db
    .select({
      id: allocationRules.id,
      name: allocationRules.name,
      kind: allocationRules.kind,
      distribution: allocationRules.distribution,
      description: allocationRules.description,
      active: allocationRules.active,
    })
    .from(allocationRules)
    .where(and(eq(allocationRules.id, id), eq(allocationRules.tenantId, tenantId)))
    .limit(1)

  if (!rule) notFound()

  const companyList = await db
    .select({
      id: companies.id,
      name: persons.name,
    })
    .from(companies)
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(eq(companies.tenantId, tenantId))
    .orderBy(asc(persons.name))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Simular rateio</h1>
        <span className="ev-badge">{rule.kind}</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/rateio/regras" className="ev-btn ev-btn-ghost">
          ← Regras
        </Link>
      </header>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ margin: 0 }}>{rule.name}</h2>
        {rule.description && <p style={{ marginBottom: 0 }}>{rule.description}</p>}
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--ev-font-sm)' }}>
            Ver distribution (JSON)
          </summary>
          <pre style={{ overflow: 'auto', fontSize: 'var(--ev-font-xs)' }}>
            {JSON.stringify(rule.distribution, null, 2)}
          </pre>
        </details>
      </section>

      <SimulatorForm
        ruleId={rule.id}
        companies={companyList.map((c) => ({ id: c.id, name: c.name ?? '—' }))}
      />
    </div>
  )
}
