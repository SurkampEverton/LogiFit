/**
 * `/app/engajamento` — overview engajamento (Sprint 09 Faixa C).
 *
 * KPIs: conquistas distribuídas no mês, brindes pendentes, metas ativas.
 * Atalhos para sub-rotas (conquistas/brindes/metas).
 */
import { and, count, eq, gte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  achievements,
  goals,
  memberAchievements,
  rewardGrants,
} from '@repo/db/schema'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function EngajamentoPage() {
  const session = await requireFullSession('/app/engajamento')
  const tenantId = session.logifit.tenantId
  const last30d = new Date()
  last30d.setDate(last30d.getDate() - 30)

  const [totalAchievements, earnedLast30d, pendingGrants, activeGoals, reachedGoals30d] = await Promise.all([
    db
      .select({ n: count() })
      .from(achievements)
      .where(and(eq(achievements.tenantId, tenantId), eq(achievements.active, true))),
    db
      .select({ n: count() })
      .from(memberAchievements)
      .where(and(eq(memberAchievements.tenantId, tenantId), gte(memberAchievements.earnedAt, last30d))),
    db
      .select({ n: count() })
      .from(rewardGrants)
      .where(and(eq(rewardGrants.tenantId, tenantId), eq(rewardGrants.status, 'pending_redeem'))),
    db
      .select({ n: count() })
      .from(goals)
      .where(and(eq(goals.tenantId, tenantId), eq(goals.status, 'active'))),
    db
      .select({ n: count() })
      .from(goals)
      .where(
        and(
          eq(goals.tenantId, tenantId),
          eq(goals.status, 'reached'),
          gte(goals.reachedAt, last30d),
        ),
      ),
  ])

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Engajamento</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Conquistas, brindes e metas dos members (Sprint 09 + ADR 0021).
        </p>
      </header>

      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        <Link
          href="/app/engajamento/conquistas"
          className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1 hover:bg-[color:var(--ev-surface)]"
        >
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
            Conquistas no catálogo
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {totalAchievements[0]?.n ?? 0}
          </div>
          <div className="text-xs text-[color:var(--ev-text-muted)]">
            {earnedLast30d[0]?.n ?? 0} desbloqueadas em 30d
          </div>
        </Link>
        <Link
          href="/app/engajamento/brindes"
          className="rounded-xl border p-5 space-y-1 hover:bg-[color:var(--ev-surface)]"
          style={{
            borderColor:
              (pendingGrants[0]?.n ?? 0) > 0 ? 'var(--ev-warning, #f59e0b)' : 'var(--ev-border)',
          }}
        >
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
            Brindes pendentes
          </div>
          <div
            className="text-2xl font-semibold tabular-nums"
            style={{
              color:
                (pendingGrants[0]?.n ?? 0) > 0 ? 'var(--ev-warning, #f59e0b)' : undefined,
            }}
          >
            {pendingGrants[0]?.n ?? 0}
          </div>
          <div className="text-xs text-[color:var(--ev-text-muted)]">Aguardam retirada/envio</div>
        </Link>
        <Link
          href="/app/engajamento/metas"
          className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1 hover:bg-[color:var(--ev-surface)]"
        >
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
            Metas ativas
          </div>
          <div className="text-2xl font-semibold tabular-nums">{activeGoals[0]?.n ?? 0}</div>
          <div className="text-xs text-[color:var(--ev-text-muted)]">
            {reachedGoals30d[0]?.n ?? 0} alcançadas em 30d
          </div>
        </Link>
      </section>

      <section className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
        <p>
          <strong>Sprint 09+ Faixa C+:</strong> dispatcher cross-alert consume{' '}
          <code>member.checked_in</code>, <code>payment.received</code>,{' '}
          <code>goal.reached</code> e re-avalia regras de conquista do member via
          DSL <code>@repo/db/engajamento/evaluator</code>. Brinde físico ganha
          workflow <code>pending_redeem → redeemed → shipped → delivered</code>.
        </p>
      </section>
    </div>
  )
}
