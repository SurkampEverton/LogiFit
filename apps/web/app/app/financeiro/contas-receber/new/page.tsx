/**
 * `/app/financeiro/contas-receber/new` — criação de AR avulso.
 */
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { chartOfAccounts, companies, persons } from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'
import { NewARForm } from './new-ar-form'

export const dynamic = 'force-dynamic'

export default async function NewARPage() {
  const session = await requireFullSession('/app/financeiro/contas-receber/new')
  const tenantId = session.logifit.tenantId

  const [companiesList, payers, leaves] = await Promise.all([
    db
      .select({ id: companies.id, name: persons.name })
      .from(companies)
      .leftJoin(persons, eq(persons.id, companies.personId))
      .where(eq(companies.tenantId, tenantId))
      .orderBy(asc(persons.name)),
    db
      .select({
        id: persons.id,
        name: persons.name,
        kind: persons.kind,
        document: persons.document,
      })
      .from(persons)
      .where(eq(persons.tenantId, tenantId))
      .orderBy(asc(persons.name))
      .limit(500),
    db
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
          eq(chartOfAccounts.isLeaf, true),
          eq(chartOfAccounts.active, true),
        ),
      )
      .orderBy(asc(chartOfAccounts.code)),
  ])

  // Para AR, filtra contas kind=receita (e ativo se eventualmente recebível patrimonial)
  const revenueLeaves = leaves.filter((l) => l.kind === 'receita' || l.kind === 'ativo')

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Novo recebível</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/contas-receber" className="ev-btn ev-btn-ghost">
          ← Contas a receber
        </Link>
      </header>

      {companiesList.length === 0 || revenueLeaves.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          {companiesList.length === 0 && <p>Cadastre uma empresa antes.</p>}
          {revenueLeaves.length === 0 && (
            <p>
              Nenhuma conta contábil de receita cadastrada. Execute{' '}
              <code>pnpm --filter @repo/db db:seed:plano-contas</code>.
            </p>
          )}
        </div>
      ) : (
        <NewARForm
          companies={companiesList.map((c) => ({ id: c.id, name: c.name ?? '(sem nome)' }))}
          payers={payers.map((p) => ({
            id: p.id,
            name: p.name ?? '(sem nome)',
            document: p.document,
            kind: p.kind,
          }))}
          leafAccounts={revenueLeaves}
        />
      )}
    </div>
  )
}
