import { db } from '@repo/db/client'
import { assessmentTypes, assessments, members, persons } from '@repo/db/schema'
/**
 * `/app/members/[id]/avaliacoes` — tabela de avaliações do member (Sprint 12 Faixa C).
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

const CATEGORY_LABELS: Record<string, string> = {
  composicao_corporal: 'Composição corporal',
  escala_funcional: 'Escala funcional',
  anamnese: 'Anamnese',
  teste_funcional: 'Teste funcional',
  custom: 'Customizado',
}

export default async function MemberAvaliacoesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await requireFullSession(`/app/members/${id}/avaliacoes`)
  const tenantId = session.logifit.tenantId

  const [member] = await db
    .select({ id: members.id, personName: persons.name })
    .from(members)
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(members.id, id), eq(members.tenantId, tenantId)))
    .limit(1)
  if (!member) notFound()

  const rows = await db
    .select({
      id: assessments.id,
      performedAt: assessments.performedAt,
      notes: assessments.notes,
      typeName: assessmentTypes.name,
      typeCategory: assessmentTypes.category,
      typeVertical: assessmentTypes.vertical,
    })
    .from(assessments)
    .leftJoin(assessmentTypes, eq(assessmentTypes.id, assessments.assessmentTypeId))
    .where(
      and(
        eq(assessments.tenantId, tenantId),
        eq(assessments.memberId, id),
        isNull(assessments.softDeletedAt),
      ),
    )
    .orderBy(desc(assessments.performedAt))
    .limit(50)

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href={`/app/members/${id}`}
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar pro perfil
        </Link>
        <div className="flex items-end justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Avaliações · {member.personName}
            </h1>
            <p className="text-sm text-[color:var(--ev-text-muted)]">
              {rows.length} avaliação(ões)
            </p>
          </div>
          <Link
            href={`/app/members/${id}/avaliacoes/new`}
            className="rounded-md bg-[color:var(--ev-primary)] px-3 py-2 text-sm text-white hover:opacity-90"
          >
            + Nova avaliação
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
          Nenhuma avaliação registrada. Use o botão "+ Nova avaliação" pra começar.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li
              key={a.id}
              className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-4 flex items-center justify-between gap-2 flex-wrap"
            >
              <div className="min-w-0">
                <Link
                  href={`/app/members/${id}/avaliacoes/${a.id}`}
                  className="font-medium hover:underline truncate block"
                >
                  {a.typeName ?? '(tipo removido)'}
                </Link>
                <div className="text-xs text-[color:var(--ev-text-muted)]">
                  {a.typeCategory && <>{CATEGORY_LABELS[a.typeCategory] ?? a.typeCategory} · </>}
                  {new Date(a.performedAt).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </div>
                {a.notes && (
                  <p className="text-xs text-[color:var(--ev-text-muted)] italic mt-1 line-clamp-2">
                    {a.notes}
                  </p>
                )}
              </div>
              <Link
                href={`/app/members/${id}/avaliacoes/${a.id}`}
                className="text-xs text-[color:var(--ev-primary)] hover:underline shrink-0"
              >
                abrir →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
