import { db } from '@repo/db/client'
import { leadStages, leads, persons } from '@repo/db/schema'
/**
 * `/app/vendas` — board kanban do funil de vendas (Sprint 10 Faixa C).
 *
 * Server Component que lê stages + leads agrupados por stage e renderiza
 * colunas estilo kanban. Para MVP, movimentação entre estágios é via
 * Select inline no detalhe (`/app/vendas/leads/[id]`); drag-and-drop fica
 * Faixa D+.
 *
 * RLS aplica via `requireFullSession()` + `withSessionContext()` no wrap-action;
 * aqui a leitura está em Server Component direto — o `db` consumido aqui
 * usa connection pool sem app.tenant_id setado, então filtra explicitamente
 * por `session.logifit.tenantId`.
 */
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

const STAGE_KIND_BORDER: Record<string, string> = {
  open: 'var(--ev-border)',
  won: 'var(--ev-success, #22c55e)',
  lost: 'var(--ev-danger, #ef4444)',
}

export default async function VendasBoardPage() {
  const session = await requireFullSession('/app/vendas')
  const tenantId = session.logifit.tenantId

  const [stages, allLeads] = await Promise.all([
    db
      .select({
        id: leadStages.id,
        slug: leadStages.slug,
        name: leadStages.name,
        orderIdx: leadStages.orderIdx,
        kind: leadStages.kind,
        color: leadStages.color,
      })
      .from(leadStages)
      .where(and(eq(leadStages.tenantId, tenantId), eq(leadStages.active, true)))
      .orderBy(asc(leadStages.orderIdx)),
    db
      .select({
        id: leads.id,
        stageId: leads.stageId,
        quickName: leads.quickName,
        quickPhone: leads.quickPhone,
        source: leads.source,
        interest: leads.interest,
        createdAt: leads.createdAt,
        personName: persons.name,
      })
      .from(leads)
      .leftJoin(persons, eq(persons.id, leads.personId))
      .where(and(eq(leads.tenantId, tenantId), isNull(leads.archivedAt)))
      .orderBy(desc(leads.createdAt))
      .limit(500),
  ])

  // Group by stage
  const byStage = new Map<string, typeof allLeads>()
  for (const stage of stages) byStage.set(stage.id, [])
  for (const lead of allLeads) {
    const arr = byStage.get(lead.stageId)
    if (arr) arr.push(lead)
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Funil de vendas</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {allLeads.length} leads ativos · {stages.length} estágios configurados
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/vendas/leads"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            Lista tabular
          </Link>
          <Link
            href="/app/vendas/leads/new"
            className="rounded-md bg-[color:var(--ev-primary)] px-3 py-2 text-sm text-white hover:opacity-90"
          >
            + Novo lead
          </Link>
        </div>
      </header>

      {stages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
          Nenhum estágio cadastrado pra este tenant. Seed deve ter populado 6 estágios default;
          verifique com <code>pnpm db:seed</code>.
        </div>
      ) : (
        <div
          className="grid gap-4 overflow-x-auto pb-4"
          style={{
            gridTemplateColumns: `repeat(${stages.length}, minmax(260px, 1fr))`,
          }}
        >
          {stages.map((stage) => {
            const stageLeads = byStage.get(stage.id) ?? []
            return (
              <section
                key={stage.id}
                className="rounded-xl border bg-[color:var(--ev-surface)] p-3 space-y-3 min-h-[200px]"
                style={{ borderColor: STAGE_KIND_BORDER[stage.kind] ?? 'var(--ev-border)' }}
              >
                <header className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">{stage.name}</h2>
                  <span
                    className="text-xs tabular-nums rounded-full px-2 py-0.5 bg-[color:var(--ev-bg)]"
                    style={{ color: stage.color ?? 'var(--ev-text-muted)' }}
                  >
                    {stageLeads.length}
                  </span>
                </header>
                <ul className="space-y-2">
                  {stageLeads.length === 0 ? (
                    <li className="text-xs text-[color:var(--ev-text-muted)] italic">
                      Nenhum lead neste estágio.
                    </li>
                  ) : (
                    stageLeads.map((lead) => (
                      <li key={lead.id}>
                        <Link
                          href={`/app/vendas/leads/${lead.id}`}
                          className="block rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3 text-sm hover:border-[color:var(--ev-primary)]"
                        >
                          <div className="font-medium truncate">
                            {lead.personName ?? lead.quickName ?? '(sem nome)'}
                          </div>
                          <div className="text-xs text-[color:var(--ev-text-muted)] truncate">
                            {lead.quickPhone ?? '—'} · {lead.source}
                          </div>
                          {lead.interest && (
                            <div className="text-xs text-[color:var(--ev-text-muted)] mt-1 truncate">
                              {lead.interest}
                            </div>
                          )}
                        </Link>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
