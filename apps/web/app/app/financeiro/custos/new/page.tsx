import { db } from '@repo/db/client'
import { companies, costCategories, persons } from '@repo/db/schema'
/**
 * `/app/financeiro/custos/new` — cadastro de custo pontual (Sprint 14 Faixa C).
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { NewCostEntryForm } from './new-cost-form'

export const dynamic = 'force-dynamic'

export default async function NewCostPage() {
  const session = await requireFullSession('/app/financeiro/custos/new')
  const tenantId = session.logifit.tenantId

  const [cats, comps] = await Promise.all([
    db
      .select({
        id: costCategories.id,
        name: costCategories.name,
        icon: costCategories.icon,
        type: costCategories.type,
      })
      .from(costCategories)
      .where(and(eq(costCategories.tenantId, tenantId), isNull(costCategories.archivedAt)))
      .orderBy(asc(costCategories.name)),
    db
      .select({ id: companies.id, name: persons.name })
      .from(companies)
      .innerJoin(persons, eq(persons.id, companies.personId))
      .where(eq(companies.tenantId, tenantId))
      .orderBy(asc(persons.name)),
  ])

  return (
    <div className="mx-auto max-w-xl px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Novo custo</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Lançamento pontual. Para recorrências mensais use{' '}
            <Link href="/app/financeiro/custos/recorrentes" className="underline">
              Recorrentes
            </Link>
            .
          </p>
        </div>
        <Link
          href="/app/financeiro/custos"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Cancelar
        </Link>
      </header>

      <NewCostEntryForm
        categories={cats}
        companies={comps.map((c) => ({ ...c, name: c.name ?? '(sem nome)' }))}
      />
    </div>
  )
}
