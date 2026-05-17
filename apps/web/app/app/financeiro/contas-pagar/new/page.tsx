/**
 * `/app/financeiro/contas-pagar/new` — formulário criação de AP em rascunho.
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  chartOfAccounts,
  companies,
  persons,
  suppliers,
} from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'
import { NewAPForm } from './new-ap-form'

export const dynamic = 'force-dynamic'

export default async function NewAPPage() {
  const session = await requireFullSession('/app/financeiro/contas-pagar/new')
  const tenantId = session.logifit.tenantId

  const [companiesList, suppliersList, leaves] = await Promise.all([
    db
      .select({ id: companies.id, name: persons.name })
      .from(companies)
      .leftJoin(persons, eq(persons.id, companies.personId))
      .where(eq(companies.tenantId, tenantId))
      .orderBy(asc(persons.name)),
    db
      .select({
        id: suppliers.id,
        name: persons.name,
        document: persons.document,
        defaultTerm: suppliers.defaultPaymentTermDays,
      })
      .from(suppliers)
      .leftJoin(persons, eq(persons.id, suppliers.personId))
      .where(and(eq(suppliers.tenantId, tenantId), isNull(suppliers.archivedAt)))
      .orderBy(asc(persons.name)),
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

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Nova conta a pagar</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/contas-pagar" className="ev-btn ev-btn-ghost">
          ← Contas a pagar
        </Link>
      </header>

      {companiesList.length === 0 || leaves.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          {companiesList.length === 0 && (
            <p>Cadastre uma empresa (CNPJ) antes de criar contas a pagar.</p>
          )}
          {leaves.length === 0 && (
            <p>
              Nenhuma conta contábil cadastrada. Execute{' '}
              <code>pnpm --filter @repo/db db:seed:plano-contas</code> ou cadastre via{' '}
              <Link href="/app/financeiro/plano-contas/new">Plano de Contas</Link>.
            </p>
          )}
        </div>
      ) : (
        <NewAPForm
          companies={companiesList.map((c) => ({ id: c.id, name: c.name ?? '(sem nome)' }))}
          suppliers={suppliersList.map((s) => ({
            id: s.id,
            name: s.name ?? '(sem nome)',
            document: s.document,
            defaultTerm: s.defaultTerm,
          }))}
          leafAccounts={leaves}
        />
      )}
    </div>
  )
}
