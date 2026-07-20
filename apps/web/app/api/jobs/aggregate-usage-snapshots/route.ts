/**
 * POST /api/jobs/aggregate-usage-snapshots — Sprint 04b (ADR 0102 + ADR 0066).
 *
 * Cron diário: UPSERT do snapshot de uso do mês corrente pra cada tenant
 * ativo — members ativos + notas fiscais cobradas. Idempotente (rodar N vezes
 * converge). `?month=YYYY-MM` recomputa mês específico (correção retroativa,
 * ex: cancelamento de nota do mês anterior).
 *
 * **Contagem de notas (ADR 0066):** `fiscal_emissions.status='completed'` com
 * `completed_at` no mês, kinds da lista fechada — eventos (cancelamento/CC-e/
 * inutilização) e `nfe_self_entry` NÃO contam.
 *
 * `ai_calls_count`/`storage_bytes` ficam 0 no MVP (fase 2 pluga fontes).
 *
 * Auth: Bearer `CRON_SECRET` (timingSafeEqual — mesmo padrão dos demais crons).
 */
import { db } from '@repo/db/client'
import { fiscalEmissions, members, tenantUsageSnapshots, tenants } from '@repo/db/schema'
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

/** Kinds cobrados no overage (ADR 0066 — lista fechada). */
const BILLABLE_KINDS = [
  'nfse',
  'nfe',
  'nfce',
  'nfe_return',
  'nfe_transfer',
  'nfe_conserto_out',
  'nfe_conserto_return',
] as const

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

function monthRange(yearMonth: string): { start: Date; end: Date } {
  const [y, m] = yearMonth.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) throw new Error(`year_month inválido: ${yearMonth}`)
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  }
}

export async function POST(request: Request) {
  if (!CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'CRON_SECRET not configured' } },
      { status: 500 },
    )
  }
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || !timingSafeEqualStr(token, CRON_SECRET)) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'invalid cron secret' } },
      { status: 401 },
    )
  }

  const url = new URL(request.url)
  const now = new Date()
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const yearMonth = url.searchParams.get('month') ?? currentMonth
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'month deve ser YYYY-MM' } },
      { status: 400 },
    )
  }
  const { start, end } = monthRange(yearMonth)

  const tenantRows = await db.select({ id: tenants.id }).from(tenants)

  let processed = 0
  let errors = 0
  for (const tenant of tenantRows) {
    try {
      const [membersRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(members)
        .where(and(eq(members.tenantId, tenant.id), isNull(members.archivedAt)))

      const [emissionsRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(fiscalEmissions)
        .where(
          and(
            eq(fiscalEmissions.tenantId, tenant.id),
            eq(fiscalEmissions.status, 'completed'),
            gte(fiscalEmissions.completedAt, start),
            lt(fiscalEmissions.completedAt, end),
            sql`${fiscalEmissions.kind} IN ('nfse','nfe','nfce','nfe_return','nfe_transfer','nfe_conserto_out','nfe_conserto_return')`,
          ),
        )

      await db
        .insert(tenantUsageSnapshots)
        .values({
          tenantId: tenant.id,
          yearMonth,
          activeMembersCount: membersRow?.count ?? 0,
          fiscalEmissionsCount: emissionsRow?.count ?? 0,
          computedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [tenantUsageSnapshots.tenantId, tenantUsageSnapshots.yearMonth],
          set: {
            activeMembersCount: membersRow?.count ?? 0,
            fiscalEmissionsCount: emissionsRow?.count ?? 0,
            computedAt: new Date(),
            updatedAt: new Date(),
          },
        })
      processed++
    } catch (err) {
      errors++
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'usage_snapshot_tenant_failed',
          tenantId: tenant.id,
          yearMonth,
          error: err instanceof Error ? err.message : 'unknown',
        }),
      )
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      year_month: yearMonth,
      billable_kinds: BILLABLE_KINDS,
      tenants_total: tenantRows.length,
      snapshots_upserted: processed,
      errors,
    },
  })
}
