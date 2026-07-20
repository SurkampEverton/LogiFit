import { db } from '@repo/db/client'
import { costCategories } from '@repo/db/schema'
/**
 * `/app/financeiro/custos/categorias` — catálogo de categorias (Sprint 14 Faixa C).
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { NewCategoryForm } from './new-category-form'

export const dynamic = 'force-dynamic'

const TYPE_LABEL = { fixed: 'Fixo', variable: 'Variável' } as const

export default async function CategoriasPage() {
  const session = await requireFullSession('/app/financeiro/custos/categorias')
  const tenantId = session.logifit.tenantId

  const rows = await db
    .select({
      id: costCategories.id,
      slug: costCategories.slug,
      name: costCategories.name,
      type: costCategories.type,
      icon: costCategories.icon,
      description: costCategories.description,
    })
    .from(costCategories)
    .where(and(eq(costCategories.tenantId, tenantId), isNull(costCategories.archivedAt)))
    .orderBy(asc(costCategories.type), asc(costCategories.name))

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Categorias de custo</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {rows.length} categorias ativas · separe fixos (aluguel/folha) de variáveis
            (marketing/manutenção)
          </p>
        </div>
        <Link
          href="/app/financeiro/custos"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          ← Custos
        </Link>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            Catálogo
          </h2>
          {rows.length === 0 ? (
            <p className="text-sm text-[color:var(--ev-text-muted)] italic">
              Nenhuma categoria. Crie uma à direita.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3 flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {c.icon ?? '💼'} {c.name}
                    </div>
                    <code className="text-[10px] text-[color:var(--ev-text-muted)]">{c.slug}</code>
                    {c.description && (
                      <p className="text-xs text-[color:var(--ev-text-muted)] mt-1">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide"
                    style={{
                      backgroundColor:
                        c.type === 'fixed'
                          ? 'var(--ev-info-bg, #dbeafe)'
                          : 'var(--ev-warning-bg, #fef3c7)',
                      color:
                        c.type === 'fixed'
                          ? 'var(--ev-info, #1e40af)'
                          : 'var(--ev-warning, #92400e)',
                    }}
                  >
                    {TYPE_LABEL[c.type]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <NewCategoryForm />
      </section>
    </div>
  )
}
