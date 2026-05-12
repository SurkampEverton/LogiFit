import { db } from '@repo/db/client'
import { companies, members, persons } from '@repo/db/schema'
import { and, eq, isNull, notInArray } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession, withSessionContext } from '../../../lib/session'
import { NewMemberForm } from './new-member-form'

export const dynamic = 'force-dynamic'

export default async function NewMemberPage() {
  const session = await requireFullSession('/app/members/new')

  // Lista persons PF disponíveis (não arquivadas + ainda não são member no tenant)
  // + companies pra dropdown
  const { availablePersons, availableCompanies } = await withSessionContext(
    session.logifit,
    async () => {
      const linkedMemberPersonIds = await db.select({ personId: members.personId }).from(members)
      const linkedSet = new Set(linkedMemberPersonIds.map((r) => r.personId))
      const linkedArr = Array.from(linkedSet)

      const conditions = [eq(persons.kind, 'pf'), isNull(persons.archivedAt)]
      if (linkedArr.length > 0) {
        conditions.push(notInArray(persons.id, linkedArr))
      }
      const personsRows = await db
        .select({
          id: persons.id,
          name: persons.name,
          email: persons.email,
          document: persons.document,
        })
        .from(persons)
        .where(and(...conditions))
        .orderBy(persons.name)

      const companiesRows = await db
        .select({ id: companies.id, name: persons.name, type: companies.type })
        .from(companies)
        .innerJoin(persons, eq(persons.id, companies.personId))
        .orderBy(companies.type, persons.name)

      return { availablePersons: personsRows, availableCompanies: companiesRows }
    },
  )

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href="/app/members"
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Cadastrar member</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Selecione uma pessoa física já cadastrada e atribua à company. Identidade
          (nome/CPF/email/telefone) vem da `persons`.
        </p>
      </header>

      {availablePersons.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--ev-border)] p-8 text-center text-sm text-[color:var(--ev-text-muted)]">
          Nenhuma PF disponível.{' '}
          <Link
            href="/app/pessoas/new"
            className="font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            Cadastre uma pessoa
          </Link>{' '}
          primeiro.
        </div>
      ) : availableCompanies.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--ev-border)] p-8 text-center text-sm text-[color:var(--ev-text-muted)]">
          Nenhuma company cadastrada — execute o wizard `/signup` ou cadastre via{' '}
          <Link
            href="/app/settings/empresas/new"
            className="font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            empresas
          </Link>
          .
        </div>
      ) : (
        <NewMemberForm
          availablePersons={availablePersons}
          availableCompanies={availableCompanies}
        />
      )}
    </main>
  )
}
