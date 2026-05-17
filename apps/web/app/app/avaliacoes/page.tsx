/**
 * `/app/avaliacoes` — lista geral de avaliações + catálogo de tipos (Sprint 12 Faixa C).
 *
 * Mostra hub: links pra catálogo de tipos + last avaliações do tenant.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  assessmentTypes,
  assessments,
  members,
  persons,
} from '@repo/db/schema'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

const CATEGORY_LABELS: Record<string, string> = {
  composicao_corporal: 'Composição corporal',
  escala_funcional: 'Escala funcional',
  anamnese: 'Anamnese',
  teste_funcional: 'Teste funcional',
  custom: 'Customizado',
}

export default async function AvaliacoesHubPage() {
  const session = await requireFullSession('/app/avaliacoes')
  const tenantId = session.logifit.tenantId

  const recent = await db
    .select({
      id: assessments.id,
      memberId: assessments.memberId,
      performedAt: assessments.performedAt,
      memberName: persons.name,
      typeName: assessmentTypes.name,
      typeCategory: assessmentTypes.category,
    })
    .from(assessments)
    .leftJoin(members, eq(members.id, assessments.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .leftJoin(assessmentTypes, eq(assessmentTypes.id, assessments.assessmentTypeId))
    .where(
      and(
        eq(assessments.tenantId, tenantId),
        isNull(assessments.softDeletedAt),
      ),
    )
    .orderBy(desc(assessments.performedAt))
    .limit(20)

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Avaliações</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {recent.length} avaliações recentes
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/avaliacoes/tipos"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            Catálogo de tipos →
          </Link>
        </div>
      </header>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Recentes
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] italic">
            Nenhuma avaliação registrada ainda. Vá em <Link href="/app/members" className="underline">members</Link> →
            aba "Avaliações" pra registrar.
          </p>
        ) : (
          <ul className="space-y-2">
            {recent.map((a) => (
              <li
                key={a.id}
                className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3 flex items-center justify-between gap-2 flex-wrap"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">
                    {a.memberName ?? '(member removido)'} ·{' '}
                    <span className="text-[color:var(--ev-text-muted)] font-normal">
                      {a.typeName ?? '(tipo removido)'}
                    </span>
                  </div>
                  <div className="text-xs text-[color:var(--ev-text-muted)]">
                    {a.typeCategory && (
                      <>{CATEGORY_LABELS[a.typeCategory] ?? a.typeCategory} · </>
                    )}
                    {new Date(a.performedAt).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </div>
                </div>
                <Link
                  href={`/app/members/${a.memberId}/avaliacoes/${a.id}`}
                  className="text-xs text-[color:var(--ev-primary)] hover:underline shrink-0"
                >
                  abrir →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
