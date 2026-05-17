/**
 * `/app/biblioteca/exercicios` — catálogo de exercícios (Sprint 11 Faixa C).
 *
 * Mostra biblioteca global (tenant_id NULL) + biblioteca do tenant em lista
 * combinada com badge "Global" / "Tenant". Filtro por busca, nível, grupo
 * muscular.
 */
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { exercises } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

interface SearchParams {
  q?: string
  level?: string
  muscle?: string
}

const LEVEL_LABEL: Record<string, string> = {
  iniciante: 'Iniciante',
  intermediario: 'Intermediário',
  avancado: 'Avançado',
}

const LEVEL_COLOR: Record<string, string> = {
  iniciante: 'var(--ev-success, #22c55e)',
  intermediario: 'var(--ev-warning, #eab308)',
  avancado: 'var(--ev-danger, #ef4444)',
}

export default async function CatalogoExerciciosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/biblioteca/exercicios')
  const tenantId = session.logifit.tenantId

  const conditions = [
    or(eq(exercises.tenantId, tenantId), isNull(exercises.tenantId)),
    eq(exercises.active, true),
    isNull(exercises.archivedAt),
  ]
  if (params.q) {
    conditions.push(sql`${exercises.name} ILIKE ${'%' + params.q + '%'}`)
  }
  if (params.level && ['iniciante', 'intermediario', 'avancado'].includes(params.level)) {
    conditions.push(sql`${exercises.level} = ${params.level}`)
  }
  if (params.muscle) {
    conditions.push(sql`${params.muscle} = ANY(${exercises.muscleGroups})`)
  }

  const rows = await db
    .select({
      id: exercises.id,
      tenantId: exercises.tenantId,
      name: exercises.name,
      description: exercises.description,
      muscleGroups: exercises.muscleGroups,
      equipment: exercises.equipment,
      level: exercises.level,
      metValue: exercises.metValue,
    })
    .from(exercises)
    .where(and(...conditions))
    .orderBy(asc(exercises.name))
    .limit(200)

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Biblioteca de exercícios
          </h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {rows.length} exercícios · biblioteca global LogiFit + tenant
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/treinos"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            Workouts →
          </Link>
          <Link
            href="/app/biblioteca/exercicios/new"
            className="rounded-md bg-[color:var(--ev-primary)] px-3 py-2 text-sm text-white hover:opacity-90"
          >
            + Novo exercício
          </Link>
        </div>
      </header>

      <form className="flex gap-2 flex-wrap items-end" method="get">
        <label className="space-y-1 text-sm flex-1 min-w-[200px]">
          <span className="block font-medium">Buscar</span>
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="agachamento, supino..."
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Nível</span>
          <select
            name="level"
            defaultValue={params.level ?? ''}
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="">Todos</option>
            <option value="iniciante">Iniciante</option>
            <option value="intermediario">Intermediário</option>
            <option value="avancado">Avançado</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Grupo muscular</span>
          <input
            type="text"
            name="muscle"
            defaultValue={params.muscle ?? ''}
            placeholder="quadriceps, peitoral..."
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Filtrar
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
          Nenhum exercício encontrado. Tente afrouxar os filtros ou cadastre um
          novo.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((ex) => (
            <article
              key={ex.id}
              className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-4 space-y-2"
            >
              <header className="flex items-start justify-between gap-2">
                <h3 className="font-medium leading-tight">{ex.name}</h3>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide"
                  style={{
                    backgroundColor: ex.tenantId === null ? 'var(--ev-info-bg, #dbeafe)' : 'var(--ev-bg)',
                    color: ex.tenantId === null ? 'var(--ev-info, #1e40af)' : 'var(--ev-text-muted)',
                    border: '1px solid var(--ev-border)',
                  }}
                >
                  {ex.tenantId === null ? 'Global' : 'Tenant'}
                </span>
              </header>
              {ex.description && (
                <p className="text-xs text-[color:var(--ev-text-muted)] line-clamp-2">
                  {ex.description}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-1 text-xs text-[color:var(--ev-text-muted)]">
                <div>
                  <dt className="inline">Nível: </dt>
                  <dd
                    className="inline font-medium"
                    style={{ color: LEVEL_COLOR[ex.level] }}
                  >
                    {LEVEL_LABEL[ex.level]}
                  </dd>
                </div>
                <div>
                  <dt className="inline">MET: </dt>
                  <dd className="inline font-medium tabular-nums">{ex.metValue}</dd>
                </div>
                {ex.equipment && (
                  <div className="col-span-2">
                    <dt className="inline">Equipamento: </dt>
                    <dd className="inline">{ex.equipment}</dd>
                  </div>
                )}
                {ex.muscleGroups.length > 0 && (
                  <div className="col-span-2 flex gap-1 flex-wrap pt-1">
                    {ex.muscleGroups.slice(0, 4).map((mg) => (
                      <span
                        key={mg}
                        className="rounded-full bg-[color:var(--ev-bg)] px-2 py-0.5 text-[10px]"
                      >
                        {mg}
                      </span>
                    ))}
                  </div>
                )}
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
