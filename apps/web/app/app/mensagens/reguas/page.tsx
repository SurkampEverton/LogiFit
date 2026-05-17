/**
 * `/app/mensagens/reguas` — lista de réguas declarativas (Sprint 13 Faixa C).
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { reguas } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function ReguasListPage() {
  const session = await requireFullSession('/app/mensagens/reguas')
  const tenantId = session.logifit.tenantId

  const rows = await db
    .select({
      id: reguas.id,
      name: reguas.name,
      description: reguas.description,
      trigger: reguas.trigger,
      actions: reguas.actions,
      active: reguas.active,
      runsCount: reguas.runsCount,
      lastRunAt: reguas.lastRunAt,
      createdAt: reguas.createdAt,
    })
    .from(reguas)
    .where(and(eq(reguas.tenantId, tenantId), isNull(reguas.archivedAt)))
    .orderBy(desc(reguas.createdAt))

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Réguas</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {rows.length} réguas · motor DSL declarativo (ADR 0026)
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/mensagens"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            ← Mensagens
          </Link>
          <Link
            href="/app/mensagens/reguas/new"
            className="rounded-md bg-[color:var(--ev-primary)] px-3 py-2 text-sm text-white hover:opacity-90"
          >
            + Nova régua
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
          Nenhuma régua. Crie uma "Cobrança D+1/+3/+7" pra disparar automaticamente
          quando <code>invoice.overdue</code> chegar.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const triggerEvent =
              (r.trigger as { event?: string } | null)?.event ?? '(sem trigger)'
            const actions = (r.actions as Array<{ kind: string; channel?: string }> | null) ?? []
            return (
              <li
                key={r.id}
                className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-4 space-y-2"
              >
                <header className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="font-medium">{r.name}</h3>
                    {r.description && (
                      <p className="text-xs text-[color:var(--ev-text-muted)]">
                        {r.description}
                      </p>
                    )}
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0"
                    style={{
                      backgroundColor: r.active
                        ? 'var(--ev-success-bg, #dcfce7)'
                        : 'var(--ev-bg)',
                      color: r.active
                        ? 'var(--ev-success, #166534)'
                        : 'var(--ev-text-muted)',
                      border: '1px solid var(--ev-border)',
                    }}
                  >
                    {r.active ? 'ativa' : 'pausada'}
                  </span>
                </header>
                <div className="flex gap-2 flex-wrap text-xs">
                  <span className="rounded-full bg-[color:var(--ev-bg)] px-2 py-0.5">
                    trigger: <code>{triggerEvent}</code>
                  </span>
                  <span className="rounded-full bg-[color:var(--ev-bg)] px-2 py-0.5">
                    {actions.length} ações
                  </span>
                  <span className="rounded-full bg-[color:var(--ev-bg)] px-2 py-0.5">
                    {r.runsCount ?? 0} runs
                  </span>
                </div>
                <div className="flex gap-1 flex-wrap text-[11px] text-[color:var(--ev-text-muted)]">
                  {actions.slice(0, 5).map((a, idx) => (
                    <span
                      key={idx}
                      className="rounded-full bg-[color:var(--ev-bg)] px-2 py-0.5"
                    >
                      {a.kind === 'send_message' ? `📤 ${a.channel}` : '⏱️ wait'}
                    </span>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
