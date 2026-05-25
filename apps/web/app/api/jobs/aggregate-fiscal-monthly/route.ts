/**
 * POST /api/jobs/aggregate-fiscal-monthly — Sprint 37b (ADR 0100).
 *
 * Cron mensal — agendar dia 5 do mês seguinte (ex: 5 de junho processa
 * apuração de maio). Calcula apuração draft pra cada `(tenant, company)`
 * ativo que ainda não tem aggregation do mês anterior, ou cujo aggregation
 * está em status='draft' (recalcula com dados mais recentes).
 *
 * **Pula closed** — apuração já fechada é imutável (regra ADR 0100).
 *
 * **Best-effort**: erro em 1 company não bloqueia o job inteiro. Loga falhas
 * estruturadas via pino + retorna contadores no response.
 *
 * **Idempotente** — rodar 2× no mesmo dia produz mesmo resultado (UPSERT em
 * fiscal_revenue_aggregations).
 *
 * **Feature flag gate** — só processa se `fiscal_apuracao_v1` está enabled.
 * Cron rodando sem flag ativa apenas loga "feature disabled" e retorna.
 *
 * Auth: shared secret via header `Authorization: Bearer $CRON_SECRET`.
 */
import { type FiscalTaxRegime, computeAggregation } from '@repo/ai'
import { db, pool } from '@repo/db/client'
import { fiscalEmissions, fiscalRevenueAggregations, fiscalRevenueBreakdown } from '@repo/db/schema'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

interface JobResult {
  processed_at: string
  year_month_processed: string
  companies_total: number
  aggregations_created: number
  aggregations_updated: number
  aggregations_skipped_closed: number
  aggregations_skipped_no_regime: number
  errors: number
  feature_disabled?: true
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

function previousMonth(now: Date): { year: number; month: number } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1 // 1-12
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 }
}

function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

const REGIME_MAP: Record<string, FiscalTaxRegime> = {
  simples: 'simples_nacional',
  simples_nacional: 'simples_nacional',
  presumido: 'lucro_presumido',
  lucro_presumido: 'lucro_presumido',
  real: 'lucro_real',
  lucro_real: 'lucro_real',
  mei: 'mei',
}

export async function POST(request: Request) {
  if (!CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'CRON_SECRET not configured' } },
      { status: 500 },
    )
  }
  const authHeader = request.headers.get('authorization') ?? ''
  if (!timingSafeEqual(authHeader, `Bearer ${CRON_SECRET}`)) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Token de cron inválido' } },
      { status: 401 },
    )
  }

  // Feature flag check via pool query direta (sem cache helper — cron é
  // entry-point novo, fresh lookup é OK)
  try {
    const flagRow = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM feature_flags WHERE key = 'fiscal_apuracao_v1' LIMIT 1`,
    )
    if (!flagRow.rows[0]?.enabled) {
      const data: JobResult = {
        processed_at: new Date().toISOString(),
        year_month_processed: '',
        companies_total: 0,
        aggregations_created: 0,
        aggregations_updated: 0,
        aggregations_skipped_closed: 0,
        aggregations_skipped_no_regime: 0,
        errors: 0,
        feature_disabled: true,
      }
      console.log(JSON.stringify({ level: 'info', job: 'aggregate-fiscal-monthly', ...data }))
      return NextResponse.json({ ok: true, data })
    }
  } catch (_err) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'feature_flag lookup failed' },
      },
      { status: 500 },
    )
  }

  const { year, month } = previousMonth(new Date())
  const yearMonth = formatYearMonth(year, month)

  try {
    // 1. Carrega todas (tenant, company) ativas globalmente (cron é system-level,
    //    bypassa RLS via service role). Tenant trial expirado fica fora — Sprint
    //    37c+ filtra `tenants.trial_expires_at < now()` etc.
    const companyRows = await pool.query<{
      id: string
      tenant_id: string
      regime_tributario: string | null
    }>(
      `SELECT c.id, c.tenant_id, c.regime_tributario
         FROM companies c
         WHERE c.regime_tributario IS NOT NULL`,
    )

    let created = 0
    let updated = 0
    let skippedClosed = 0
    let skippedNoRegime = 0
    let errors = 0

    for (const company of companyRows.rows) {
      try {
        const taxRegime = REGIME_MAP[company.regime_tributario ?? '']
        if (!taxRegime) {
          skippedNoRegime++
          continue
        }

        // Verifica se já existe + estado
        const [existing] = await db
          .select({
            id: fiscalRevenueAggregations.id,
            status: fiscalRevenueAggregations.status,
          })
          .from(fiscalRevenueAggregations)
          .where(
            and(
              eq(fiscalRevenueAggregations.tenantId, company.tenant_id),
              eq(fiscalRevenueAggregations.companyId, company.id),
              eq(fiscalRevenueAggregations.yearMonth, yearMonth),
            ),
          )
          .limit(1)

        if (existing?.status === 'closed') {
          skippedClosed++
          continue
        }

        // Coleta receita do mês + RBT12
        const from = new Date(Date.UTC(year, month - 1, 1))
        const to = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1))
        const rbt12From = new Date(Date.UTC(year, month - 12, 1))

        const monthRows = await db
          .select({
            kind: fiscalEmissions.kind,
            total: sql<number>`COALESCE(SUM(${fiscalEmissions.valorTotalCents}), 0)`,
            count: sql<number>`COUNT(*)`,
          })
          .from(fiscalEmissions)
          .where(
            and(
              eq(fiscalEmissions.tenantId, company.tenant_id),
              eq(fiscalEmissions.companyId, company.id),
              eq(fiscalEmissions.status, 'completed'),
              gte(fiscalEmissions.completedAt, from),
              lt(fiscalEmissions.completedAt, to),
            ),
          )
          .groupBy(fiscalEmissions.kind)

        let receitaServicos = 0
        let receitaMercadorias = 0
        const breakdown = new Map<string, { count: number; totalCents: number }>()
        for (const row of monthRows) {
          const total = Number(row.total ?? 0)
          const count = Number(row.count ?? 0)
          breakdown.set(row.kind, { count, totalCents: total })
          if (row.kind === 'nfse') receitaServicos += total
          else if (row.kind === 'nfe' || row.kind === 'nfce') receitaMercadorias += total
        }

        const rbt12Rows = await db
          .select({
            total: sql<number>`COALESCE(SUM(${fiscalEmissions.valorTotalCents}), 0)`,
          })
          .from(fiscalEmissions)
          .where(
            and(
              eq(fiscalEmissions.tenantId, company.tenant_id),
              eq(fiscalEmissions.companyId, company.id),
              eq(fiscalEmissions.status, 'completed'),
              gte(fiscalEmissions.completedAt, rbt12From),
              lt(fiscalEmissions.completedAt, to),
              sql`${fiscalEmissions.kind} IN ('nfse', 'nfe', 'nfce')`,
            ),
          )
        const rbt12Cents = Number(rbt12Rows[0]?.total ?? 0)

        // Dispatcher cálculo
        const result = computeAggregation({
          regime: taxRegime,
          receitaServicosCents: receitaServicos,
          receitaMercadoriasCents: receitaMercadorias,
          rbt12Cents,
          competenciaDate: `${yearMonth}-01`,
        })

        // UPSERT
        await db.transaction(async (tx) => {
          if (existing) {
            await tx
              .update(fiscalRevenueAggregations)
              .set({
                taxRegime,
                receitaServicosCents: receitaServicos,
                receitaMercadoriasCents: receitaMercadorias,
                receitaTotalCents: result.receitaTotalCents,
                rbt12Cents: result.rbt12Cents,
                aliquotaEfetivaBp: result.aliquotaEfetivaBp,
                impostoApuradoCents: result.impostoApuradoCents,
                memorial: result.memorial,
                computedAt: new Date(),
              })
              .where(eq(fiscalRevenueAggregations.id, existing.id))

            await tx
              .delete(fiscalRevenueBreakdown)
              .where(eq(fiscalRevenueBreakdown.aggregationId, existing.id))

            for (const [kind, data] of breakdown) {
              await tx.insert(fiscalRevenueBreakdown).values({
                aggregationId: existing.id,
                // biome-ignore lint/suspicious/noExplicitAny: kind é fiscal_emission_kind enum string
                emissionKind: kind as any,
                count: data.count,
                totalCents: data.totalCents,
              })
            }
            updated++
          } else {
            const [inserted] = await tx
              .insert(fiscalRevenueAggregations)
              .values({
                tenantId: company.tenant_id,
                companyId: company.id,
                yearMonth,
                taxRegime,
                receitaServicosCents: receitaServicos,
                receitaMercadoriasCents: receitaMercadorias,
                receitaTotalCents: result.receitaTotalCents,
                rbt12Cents: result.rbt12Cents,
                aliquotaEfetivaBp: result.aliquotaEfetivaBp,
                impostoApuradoCents: result.impostoApuradoCents,
                memorial: result.memorial,
                status: 'draft',
              })
              .returning({ id: fiscalRevenueAggregations.id })

            if (inserted) {
              for (const [kind, data] of breakdown) {
                await tx.insert(fiscalRevenueBreakdown).values({
                  aggregationId: inserted.id,
                  // biome-ignore lint/suspicious/noExplicitAny: kind é fiscal_emission_kind enum string
                  emissionKind: kind as any,
                  count: data.count,
                  totalCents: data.totalCents,
                })
              }
              created++
            }
          }
        })
      } catch (err) {
        errors++
        console.error(
          JSON.stringify({
            level: 'error',
            job: 'aggregate-fiscal-monthly',
            event: 'company_failed',
            company_id: company.id.slice(0, 8),
            tenant_id: company.tenant_id.slice(0, 8),
            year_month: yearMonth,
            error: err instanceof Error ? err.message : 'unknown',
          }),
        )
      }
    }

    const data: JobResult = {
      processed_at: new Date().toISOString(),
      year_month_processed: yearMonth,
      companies_total: companyRows.rows.length,
      aggregations_created: created,
      aggregations_updated: updated,
      aggregations_skipped_closed: skippedClosed,
      aggregations_skipped_no_regime: skippedNoRegime,
      errors,
    }

    console.log(JSON.stringify({ level: 'info', job: 'aggregate-fiscal-monthly', ...data }))
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        level: 'error',
        job: 'aggregate-fiscal-monthly',
        error: message,
      }),
    )
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Falha ao agregar apurações fiscais' },
      },
      { status: 500 },
    )
  }
}
