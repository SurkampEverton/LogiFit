import { db } from '@repo/db/client'
import { assessmentTypes, members, persons } from '@repo/db/schema'
/**
 * `/app/members/[id]/avaliacoes/new` — wizard dinâmico de avaliação (Sprint 12 Faixa C).
 *
 * Escolhe tipo (lista global + tenant), renderiza form dinâmico baseado em
 * `fields jsonb` do tipo. Captura context (idade, sexo) pra cálculos
 * derivados (IMC, Pollock, TMB).
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../../lib/session'
import { NewAssessmentForm } from './new-assessment-form'

export const dynamic = 'force-dynamic'

interface FieldDef {
  key: string
  label: string
  kind: 'number' | 'text' | 'enum' | 'likert'
  unit?: string
  min?: number
  max?: number
  options?: string[]
}

export default async function NewMemberAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await requireFullSession(`/app/members/${id}/avaliacoes/new`)
  const tenantId = session.logifit.tenantId

  const [member] = await db
    .select({
      id: members.id,
      personName: persons.name,
      birthDate: persons.birthDate,
      sex: persons.sex,
    })
    .from(members)
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(members.id, id), eq(members.tenantId, tenantId)))
    .limit(1)
  if (!member) notFound()

  const types = await db
    .select({
      id: assessmentTypes.id,
      tenantId: assessmentTypes.tenantId,
      name: assessmentTypes.name,
      category: assessmentTypes.category,
      vertical: assessmentTypes.vertical,
      fields: assessmentTypes.fields,
    })
    .from(assessmentTypes)
    .where(
      and(
        or(eq(assessmentTypes.tenantId, tenantId), isNull(assessmentTypes.tenantId)),
        eq(assessmentTypes.active, true),
        isNull(assessmentTypes.archivedAt),
      ),
    )
    .orderBy(asc(assessmentTypes.name))

  // Idade calculada se birth_date existe
  const ageYears = member.birthDate
    ? Math.floor(
        (Date.now() - new Date(member.birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25),
      )
    : null
  const sex = (member.sex === 'M' ? 'male' : member.sex === 'F' ? 'female' : null) as
    | 'male'
    | 'female'
    | null

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href={`/app/members/${id}/avaliacoes`}
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar pras avaliações
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Nova avaliação · {member.personName}
        </h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          {ageYears ? `${ageYears} anos · ` : ''}
          {sex === 'male' ? 'M' : sex === 'female' ? 'F' : 'sem sexo cadastrado'}
        </p>
      </header>

      <NewAssessmentForm
        memberId={id}
        types={types.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          vertical: t.vertical,
          isGlobal: t.tenantId === null,
          fields: t.fields as FieldDef[],
        }))}
        defaultAgeYears={ageYears}
        defaultSex={sex}
      />
    </main>
  )
}
