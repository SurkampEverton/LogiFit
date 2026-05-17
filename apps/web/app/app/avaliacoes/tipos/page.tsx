/**
 * `/app/avaliacoes/tipos` — catálogo de tipos (global + tenant) (Sprint 12 Faixa C).
 *
 * Mostra tipos visíveis ao tenant: globais (curador LogiFit) + customizados.
 * Filtros por category/vertical. Botão "+ Novo tipo" abre form customizado.
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { assessmentTypes } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

interface SearchParams {
  category?: string
  vertical?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  composicao_corporal: 'Composição corporal',
  escala_funcional: 'Escala funcional',
  anamnese: 'Anamnese',
  teste_funcional: 'Teste funcional',
  custom: 'Customizado',
}

const VERTICAL_LABELS: Record<string, string> = {
  academia: 'Academia',
  fisio: 'Fisioterapia',
  nutri: 'Nutrição',
}

const VERTICAL_COLOR: Record<string, string> = {
  academia: 'var(--ev-success, #22c55e)',
  fisio: 'var(--ev-info, #3b82f6)',
  nutri: 'var(--ev-warning, #eab308)',
}

export default async function CatalogoTiposPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/avaliacoes/tipos')
  const tenantId = session.logifit.tenantId

  const conditions = [
    or(eq(assessmentTypes.tenantId, tenantId), isNull(assessmentTypes.tenantId)),
    eq(assessmentTypes.active, true),
    isNull(assessmentTypes.archivedAt),
  ]
  if (params.category) {
    conditions.push(eq(assessmentTypes.category, params.category as 'custom'))
  }
  if (params.vertical) {
    conditions.push(eq(assessmentTypes.vertical, params.vertical as 'academia'))
  }

  const rows = await db
    .select({
      id: assessmentTypes.id,
      tenantId: assessmentTypes.tenantId,
      name: assessmentTypes.name,
      description: assessmentTypes.description,
      category: assessmentTypes.category,
      vertical: assessmentTypes.vertical,
      fields: assessmentTypes.fields,
      clinicalReference: assessmentTypes.clinicalReference,
      version: assessmentTypes.version,
    })
    .from(assessmentTypes)
    .where(and(...conditions))
    .orderBy(asc(assessmentTypes.name))

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Catálogo de tipos
          </h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {rows.length} tipos · biblioteca global LogiFit + customizados do tenant
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/avaliacoes"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            ← Avaliações
          </Link>
          <Link
            href="/app/avaliacoes/tipos/new"
            className="rounded-md bg-[color:var(--ev-primary)] px-3 py-2 text-sm text-white hover:opacity-90"
          >
            + Novo tipo
          </Link>
        </div>
      </header>

      <form method="get" className="flex gap-2 flex-wrap items-end">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Categoria</span>
          <select
            name="category"
            defaultValue={params.category ?? ''}
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="">Todas</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Vertical</span>
          <select
            name="vertical"
            defaultValue={params.vertical ?? ''}
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="">Todas</option>
            {Object.entries(VERTICAL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
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
          Nenhum tipo encontrado. Crie um customizado pra cadastrar
          avaliações.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => {
            const fields = (t.fields as Array<{ key: string; label: string }>).slice(0, 4)
            return (
              <article
                key={t.id}
                className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-4 space-y-2"
              >
                <header className="flex items-start justify-between gap-2">
                  <h3 className="font-medium leading-tight">{t.name}</h3>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0"
                    style={{
                      backgroundColor: t.tenantId === null ? 'var(--ev-info-bg, #dbeafe)' : 'var(--ev-bg)',
                      color: t.tenantId === null ? 'var(--ev-info, #1e40af)' : 'var(--ev-text-muted)',
                      border: '1px solid var(--ev-border)',
                    }}
                  >
                    {t.tenantId === null ? 'Global' : 'Tenant'}
                  </span>
                </header>
                {t.description && (
                  <p className="text-xs text-[color:var(--ev-text-muted)] line-clamp-2">
                    {t.description}
                  </p>
                )}
                <div className="flex gap-1 flex-wrap text-xs">
                  <span className="rounded-full bg-[color:var(--ev-bg)] px-2 py-0.5 text-[color:var(--ev-text-muted)]">
                    {CATEGORY_LABELS[t.category] ?? t.category}
                  </span>
                  {t.vertical && (
                    <span
                      className="rounded-full px-2 py-0.5"
                      style={{
                        backgroundColor: 'var(--ev-bg)',
                        color: VERTICAL_COLOR[t.vertical],
                      }}
                    >
                      {VERTICAL_LABELS[t.vertical]}
                    </span>
                  )}
                </div>
                {fields.length > 0 && (
                  <div className="text-xs text-[color:var(--ev-text-muted)]">
                    Campos: {fields.map((f) => f.label).join(', ')}
                    {(t.fields as unknown[]).length > 4 && '...'}
                  </div>
                )}
                {t.clinicalReference && (
                  <p className="text-[10px] italic text-[color:var(--ev-text-muted)]">
                    Ref: {t.clinicalReference}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
