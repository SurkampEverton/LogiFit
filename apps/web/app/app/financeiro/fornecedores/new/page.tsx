/**
 * `/app/financeiro/fornecedores/new` — adicionar fornecedor (Sprint 15 Faixa C).
 *
 * MVP: lista persons existentes (kind=pj OR pf) sem supplier ainda + form com
 * defaults. PersonPicker rico fica Sprint 15+. Botão "cadastrar nova pessoa
 * antes" leva a `/app/pessoas/new` (Sprint 02).
 */
import { and, asc, eq, isNull, notInArray, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { persons, suppliers } from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'
import { NewSupplierForm } from './new-supplier-form'

export const dynamic = 'force-dynamic'

export default async function NewSupplierPage() {
  const session = await requireFullSession('/app/financeiro/fornecedores/new')
  const tenantId = session.logifit.tenantId

  // Subquery de persons que JÁ são suppliers
  const existingSupplierPersonIds = await db
    .select({ personId: suppliers.personId })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, tenantId), isNull(suppliers.archivedAt)))
  const usedIds = existingSupplierPersonIds.map((r) => r.personId)

  // Lista persons disponíveis (sem supplier vinculado)
  let availableQuery = db
    .select({
      id: persons.id,
      name: persons.name,
      document: persons.document,
      kind: persons.kind,
      email: persons.email,
    })
    .from(persons)
    .where(eq(persons.tenantId, tenantId))
    .orderBy(asc(persons.name))
    .$dynamic()

  if (usedIds.length > 0) {
    availableQuery = availableQuery.where(
      and(eq(persons.tenantId, tenantId), notInArray(persons.id, usedIds)),
    )
  }

  const available = await availableQuery.limit(500)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Adicionar fornecedor</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/fornecedores" className="ev-btn ev-btn-ghost">
          ← Fornecedores
        </Link>
      </header>

      {available.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Não há pessoas disponíveis para virar fornecedor. Cadastre uma pessoa (PJ ou PF) antes em{' '}
            <Link href="/app/pessoas/new">/app/pessoas/new</Link>.
          </p>
        </div>
      ) : (
        <NewSupplierForm persons={available} />
      )}
    </div>
  )
}
