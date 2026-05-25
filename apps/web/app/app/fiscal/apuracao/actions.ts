'use server'

/**
 * Server Actions Fiscal Apuração Mensal — Sprint 37a (ADR 0100 Proposed).
 *
 * **Backbone Sprint 37a:**
 *   - `aggregateMonthlyRevenue` — agrega + persist transacional (ON CONFLICT update if draft)
 *   - `getAggregation` — read com breakdown
 *   - `listAggregations` — read paginado por filters
 *   - `regenerateAggregation` — re-roda compute (rejeita se closed via trigger SQL)
 *   - `closeAggregation` — marca closed_at + closed_by (trigger bloqueia UPDATE pós-closed)
 *   - `exportMemorialPdf` — stub Sprint 37b
 *
 * **Pendente Sprint 37b/c:** Lucro Real real com cost_entries (Sprint 14), cron
 *   mensal aggregate-fiscal-monthly, permissions RBAC fiscal.apuracao.*, memorial
 *   PDF render via @react-pdf/renderer, feature flag fiscal_apuracao_v1, E2E
 *   Playwright, RIPD + DPO sign-off, cross-alert teto Simples, integração régua
 *   Sprint 13 (lembrete vencimento DAS dia 20), pesquisa global ADR 0062.
 */

import { type FiscalSimplesAnexo, type FiscalTaxRegime, computeAggregation } from '@repo/ai'
import { db, pool } from '@repo/db/client'
import {
  companies,
  fiscalEmissions,
  fiscalRevenueAggregations,
  fiscalRevenueBreakdown,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { isFeatureEnabled } from '../../../lib/feature-flags'
import { dispatchSimplesCeilingAlert } from '../../../lib/fiscal-apuracao-alerts'
import { requirePermission } from '../../../lib/permissions'
import { wrapServerAction } from '../../../lib/wrap-action'

/** Gate compartilhado pelas 5 SAs (regra 12 — feature flag em CI). */
async function requireApuracaoFlag(): Promise<void> {
  if (!(await isFeatureEnabled('fiscal_apuracao_v1'))) {
    throw new ApiException({
      code: 'FORBIDDEN',
      message: 'Feature fiscal_apuracao_v1 ainda não habilitada neste ambiente.',
      request_id: '',
    })
  }
}

// ─── Zod schemas ─────────────────────────────────────────────────────────

// RegimeEnum reservado pra Sprint 37b (override de regime no form do operador)
const AnexoEnum = z.enum(['III', 'V'])
const PresumidoAtividadeEnum = z.enum([
  'REVENDA',
  'SERVICO_SAUDE',
  'SERVICO_GERAL',
  'TRANSPORTE_CARGAS',
])
const MeiAtividadeEnum = z.enum(['servico', 'comercio', 'ambos'])

const AggregateInputSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  companyId: z.string().uuid(),
  /** Override de anexo Simples (default III; V quando Fator R < 28%) */
  anexo: AnexoEnum.optional(),
  /** Override de atividade Presumido (default SERVICO_SAUDE) */
  presumidoAtividade: PresumidoAtividadeEnum.optional(),
  /** Override de atividade MEI (default servico) */
  meiAtividade: MeiAtividadeEnum.optional(),
  /** Fator R informado pelo operador (Simples Anexo V auto-derivation futuro) */
  fatorR: z.number().min(0).max(1).optional(),
})

const IdSchema = z.object({ id: z.string().uuid() })

const ListFiltersSchema = z
  .object({
    year: z.number().int().min(2020).max(2100).optional(),
    companyId: z.string().uuid().optional(),
    status: z.enum(['draft', 'closed']).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .optional()

// ─── helpers ─────────────────────────────────────────────────────────────

function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function firstOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0))
}

function firstOfNextMonth(year: number, month: number): Date {
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  return new Date(Date.UTC(nextYear, nextMonth - 1, 1, 0, 0, 0))
}

// Soma da receita do mês por kind. RBT12 = soma últimas 12 competências (mês corrente inclusive).
async function fetchMonthlyRevenue(
  tenantId: string,
  companyId: string,
  year: number,
  month: number,
): Promise<{
  receitaServicosCents: number
  receitaMercadoriasCents: number
  rbt12Cents: number
  breakdown: Map<string, { count: number; totalCents: number }>
}> {
  const from = firstOfMonth(year, month)
  const to = firstOfNextMonth(year, month)

  // Receita do mês
  const rows = await db
    .select({
      kind: fiscalEmissions.kind,
      total: sql<number>`COALESCE(SUM(${fiscalEmissions.valorTotalCents}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(fiscalEmissions)
    .where(
      and(
        eq(fiscalEmissions.tenantId, tenantId),
        eq(fiscalEmissions.companyId, companyId),
        eq(fiscalEmissions.status, 'completed'),
        gte(fiscalEmissions.completedAt, from),
        lt(fiscalEmissions.completedAt, to),
      ),
    )
    .groupBy(fiscalEmissions.kind)

  let receitaServicos = 0
  let receitaMercadorias = 0
  const breakdown = new Map<string, { count: number; totalCents: number }>()
  for (const row of rows) {
    const total = Number(row.total ?? 0)
    const count = Number(row.count ?? 0)
    breakdown.set(row.kind, { count, totalCents: total })
    if (row.kind === 'nfse') {
      receitaServicos += total
    } else if (row.kind === 'nfe' || row.kind === 'nfce') {
      receitaMercadorias += total
    }
    // nfe_return / nfe_transfer / nfe_conserto_* / nfe_self_entry não contam como receita
  }

  // RBT12 — soma últimas 12 competências (incluindo o mês corrente)
  const rbt12From = firstOfMonth(month === 12 ? year - 0 : year - 1, month === 12 ? 1 : month + 1)
  // Mais simples: 12 meses atrás:
  const rbt12FromCorrect = new Date(Date.UTC(year, month - 12, 1, 0, 0, 0))
  const rbt12Rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${fiscalEmissions.valorTotalCents}), 0)`,
    })
    .from(fiscalEmissions)
    .where(
      and(
        eq(fiscalEmissions.tenantId, tenantId),
        eq(fiscalEmissions.companyId, companyId),
        eq(fiscalEmissions.status, 'completed'),
        gte(fiscalEmissions.completedAt, rbt12FromCorrect),
        lt(fiscalEmissions.completedAt, to),
        sql`${fiscalEmissions.kind} IN ('nfse', 'nfe', 'nfce')`,
      ),
    )
  const rbt12Cents = Number(rbt12Rows[0]?.total ?? 0)

  // suprime lint do unused rbt12From acima
  void rbt12From

  return {
    receitaServicosCents: receitaServicos,
    receitaMercadoriasCents: receitaMercadorias,
    rbt12Cents,
    breakdown,
  }
}

// ─── aggregateMonthlyRevenue ─────────────────────────────────────────────

export const aggregateMonthlyRevenue = wrapServerAction(
  {
    module: 'fiscal',
    action: 'apuracao.aggregate',
    resourceType: 'fiscal_revenue_aggregations',
  },
  async (input: z.infer<typeof AggregateInputSchema>, { session, setAuditResource }) => {
    await requireApuracaoFlag()
    await requirePermission(session.user.id, 'fiscal.apuracao.write')
    const parsed = AggregateInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const yearMonth = formatYearMonth(parsed.year, parsed.month)

    // Carrega company + regime tributário vigente (snapshot)
    const [company] = await db
      .select({
        id: companies.id,
        regimeTributario: companies.regimeTributario,
      })
      .from(companies)
      .where(and(eq(companies.id, parsed.companyId), eq(companies.tenantId, tenantId)))
      .limit(1)

    if (!company) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Company não encontrada neste tenant',
        request_id: '',
      })
    }

    // Mapeia regime de `companies.regime_tributario` (text) pro enum canônico
    const regimeMap: Record<string, FiscalTaxRegime> = {
      simples: 'simples_nacional',
      simples_nacional: 'simples_nacional',
      presumido: 'lucro_presumido',
      lucro_presumido: 'lucro_presumido',
      real: 'lucro_real',
      lucro_real: 'lucro_real',
      mei: 'mei',
    }
    const taxRegime = regimeMap[company.regimeTributario ?? '']
    if (!taxRegime) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Company sem regime tributário válido cadastrado. Atual: ${company.regimeTributario ?? '(null)'}`,
        request_id: '',
      })
    }

    // Verifica se existe aggregation; se sim e está closed, rejeita
    const [existing] = await db
      .select({ id: fiscalRevenueAggregations.id, status: fiscalRevenueAggregations.status })
      .from(fiscalRevenueAggregations)
      .where(
        and(
          eq(fiscalRevenueAggregations.tenantId, tenantId),
          eq(fiscalRevenueAggregations.companyId, parsed.companyId),
          eq(fiscalRevenueAggregations.yearMonth, yearMonth),
        ),
      )
      .limit(1)

    if (existing && existing.status === 'closed') {
      throw new ApiException({
        code: 'CONFLICT',
        message:
          'Apuração já fechada deste período é imutável. Reabertura requer super_admin (Sprint 37c+).',
        request_id: '',
      })
    }

    // Coleta receita + RBT12 da fiscal_emissions
    const { receitaServicosCents, receitaMercadoriasCents, rbt12Cents, breakdown } =
      await fetchMonthlyRevenue(tenantId, parsed.companyId, parsed.year, parsed.month)

    // Roda calculator
    const result = computeAggregation({
      regime: taxRegime,
      receitaServicosCents,
      receitaMercadoriasCents,
      rbt12Cents,
      anexo: parsed.anexo as FiscalSimplesAnexo | undefined,
      fatorR: parsed.fatorR,
      competenciaDate: `${yearMonth}-01`,
    })

    // Persist transacional: upsert aggregation + replace breakdown
    const aggregationId = await db.transaction(async (tx) => {
      if (existing) {
        // UPDATE in place (trigger garante que só draft permite mudança)
        await tx
          .update(fiscalRevenueAggregations)
          .set({
            taxRegime,
            receitaServicosCents,
            receitaMercadoriasCents,
            receitaTotalCents: result.receitaTotalCents,
            rbt12Cents: result.rbt12Cents,
            aliquotaEfetivaBp: result.aliquotaEfetivaBp,
            impostoApuradoCents: result.impostoApuradoCents,
            memorial: result.memorial,
            computedAt: new Date(),
          })
          .where(eq(fiscalRevenueAggregations.id, existing.id))
        // Reset breakdown
        await tx
          .delete(fiscalRevenueBreakdown)
          .where(eq(fiscalRevenueBreakdown.aggregationId, existing.id))
        return existing.id
      }
      const [inserted] = await tx
        .insert(fiscalRevenueAggregations)
        .values({
          tenantId,
          companyId: parsed.companyId,
          yearMonth,
          taxRegime,
          receitaServicosCents,
          receitaMercadoriasCents,
          receitaTotalCents: result.receitaTotalCents,
          rbt12Cents: result.rbt12Cents,
          aliquotaEfetivaBp: result.aliquotaEfetivaBp,
          impostoApuradoCents: result.impostoApuradoCents,
          memorial: result.memorial,
          status: 'draft',
        })
        .returning({ id: fiscalRevenueAggregations.id })
      const newId = inserted?.id
      if (!newId) {
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'INSERT aggregation não retornou id',
          request_id: '',
        })
      }
      return newId
    })

    // Insere breakdown numa transação separada (FK on agg_id)
    for (const [kind, data] of breakdown) {
      await db.insert(fiscalRevenueBreakdown).values({
        aggregationId,
        // biome-ignore lint/suspicious/noExplicitAny: kind vem da query SQL como string genérica do enum fiscal_emission_kind
        emissionKind: kind as any,
        count: data.count,
        totalCents: data.totalCents,
      })
    }

    setAuditResource(aggregationId, {
      year_month: yearMonth,
      regime: taxRegime,
      receita_total: result.receitaTotalCents,
      imposto: result.impostoApuradoCents,
    })

    // Cross-alert teto Simples (best-effort fora da tx — Sprint 37b)
    if (taxRegime === 'simples_nacional' && result.rbt12Cents !== null) {
      await dispatchSimplesCeilingAlert({
        tenantId,
        companyId: parsed.companyId,
        rbt12Cents: result.rbt12Cents,
        yearMonth,
      })
    }

    return {
      ok: true as const,
      aggregationId,
      yearMonth,
      regime: taxRegime,
      receitaTotalCents: result.receitaTotalCents,
      impostoApuradoCents: result.impostoApuradoCents,
      aliquotaEfetivaBp: result.aliquotaEfetivaBp,
    }
  },
)

// ─── getAggregation ──────────────────────────────────────────────────────

export const getAggregation = wrapServerAction(
  { module: 'fiscal', action: 'apuracao.get' },
  async (input: z.infer<typeof IdSchema>, { session }) => {
    await requirePermission(session.user.id, 'fiscal.apuracao.read')
    const parsed = IdSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [agg] = await db
      .select()
      .from(fiscalRevenueAggregations)
      .where(
        and(
          eq(fiscalRevenueAggregations.id, parsed.id),
          eq(fiscalRevenueAggregations.tenantId, tenantId),
        ),
      )
      .limit(1)

    if (!agg) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Apuração não encontrada',
        request_id: '',
      })
    }

    const breakdown = await db
      .select()
      .from(fiscalRevenueBreakdown)
      .where(eq(fiscalRevenueBreakdown.aggregationId, agg.id))

    return { ok: true as const, aggregation: agg, breakdown }
  },
)

// ─── listAggregations ────────────────────────────────────────────────────

export const listAggregations = wrapServerAction(
  { module: 'fiscal', action: 'apuracao.list' },
  async (input: unknown, { session }) => {
    await requirePermission(session.user.id, 'fiscal.apuracao.read')
    const parsed = ListFiltersSchema.parse(input ?? {}) ?? { limit: 50 }
    const tenantId = session.logifit.tenantId

    const conditions = [eq(fiscalRevenueAggregations.tenantId, tenantId)]
    if (parsed.companyId) {
      conditions.push(eq(fiscalRevenueAggregations.companyId, parsed.companyId))
    }
    if (parsed.status) {
      conditions.push(eq(fiscalRevenueAggregations.status, parsed.status))
    }
    if (parsed.year) {
      conditions.push(sql`${fiscalRevenueAggregations.yearMonth} LIKE ${`${parsed.year}-%`}`)
    }

    const rows = await db
      .select()
      .from(fiscalRevenueAggregations)
      .where(and(...conditions))
      .orderBy(desc(fiscalRevenueAggregations.yearMonth))
      .limit(parsed.limit)

    return { ok: true as const, rows }
  },
)

// ─── regenerateAggregation ───────────────────────────────────────────────

export const regenerateAggregation = wrapServerAction(
  {
    module: 'fiscal',
    action: 'apuracao.regenerate',
    resourceType: 'fiscal_revenue_aggregations',
  },
  async (input: z.infer<typeof IdSchema>, { session, setAuditResource }) => {
    await requireApuracaoFlag()
    await requirePermission(session.user.id, 'fiscal.apuracao.write')
    const parsed = IdSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [agg] = await db
      .select({
        id: fiscalRevenueAggregations.id,
        companyId: fiscalRevenueAggregations.companyId,
        yearMonth: fiscalRevenueAggregations.yearMonth,
        status: fiscalRevenueAggregations.status,
      })
      .from(fiscalRevenueAggregations)
      .where(
        and(
          eq(fiscalRevenueAggregations.id, parsed.id),
          eq(fiscalRevenueAggregations.tenantId, tenantId),
        ),
      )
      .limit(1)

    if (!agg) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Apuração não encontrada',
        request_id: '',
      })
    }

    if (agg.status === 'closed') {
      throw new ApiException({
        code: 'CONFLICT',
        message:
          'Apuração fechada é imutável. Reabra antes (Sprint 37c+) ou crie aggregation nova.',
        request_id: '',
      })
    }

    // Parse year+month do yearMonth 'YYYY-MM'
    const yearStr = agg.yearMonth.slice(0, 4)
    const monthStr = agg.yearMonth.slice(5, 7)
    const year = Number(yearStr)
    const month = Number(monthStr)

    // Reusa aggregateMonthlyRevenue passando os mesmos params
    const result = await aggregateMonthlyRevenue({
      year,
      month,
      companyId: agg.companyId,
    })

    setAuditResource(agg.id, { regenerated: true })
    return result
  },
)

// ─── closeAggregation ────────────────────────────────────────────────────

export const closeAggregation = wrapServerAction(
  {
    module: 'fiscal',
    action: 'apuracao.close',
    resourceType: 'fiscal_revenue_aggregations',
  },
  async (input: z.infer<typeof IdSchema>, { session, setAuditResource }) => {
    await requireApuracaoFlag()
    await requirePermission(session.user.id, 'fiscal.apuracao.close')
    const parsed = IdSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [agg] = await db
      .update(fiscalRevenueAggregations)
      .set({
        status: 'closed',
        closedAt: new Date(),
        closedByUserId: session.user.id,
      })
      .where(
        and(
          eq(fiscalRevenueAggregations.id, parsed.id),
          eq(fiscalRevenueAggregations.tenantId, tenantId),
          eq(fiscalRevenueAggregations.status, 'draft'),
        ),
      )
      .returning({
        id: fiscalRevenueAggregations.id,
        yearMonth: fiscalRevenueAggregations.yearMonth,
      })

    if (!agg) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Apuração não encontrada ou já está fechada',
        request_id: '',
      })
    }

    setAuditResource(agg.id, { year_month: agg.yearMonth, closed: true })
    return { ok: true as const }
  },
)

// ─── exportMemorialPdf — Sprint 37b ──────────────────────────────────────

export const exportMemorialPdf = wrapServerAction(
  { module: 'fiscal', action: 'apuracao.export_pdf' },
  async (input: z.infer<typeof IdSchema>, { session, setAuditResource }) => {
    await requirePermission(session.user.id, 'fiscal.apuracao.read')
    const parsed = IdSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [agg] = await db
      .select()
      .from(fiscalRevenueAggregations)
      .where(
        and(
          eq(fiscalRevenueAggregations.id, parsed.id),
          eq(fiscalRevenueAggregations.tenantId, tenantId),
        ),
      )
      .limit(1)

    if (!agg) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Apuração não encontrada',
        request_id: '',
      })
    }

    const breakdownRows = await db
      .select({
        emissionKind: fiscalRevenueBreakdown.emissionKind,
        count: fiscalRevenueBreakdown.count,
        totalCents: fiscalRevenueBreakdown.totalCents,
      })
      .from(fiscalRevenueBreakdown)
      .where(eq(fiscalRevenueBreakdown.aggregationId, agg.id))

    // Resolve company name via JOIN persons
    const companyRow = await pool.query<{ name: string }>(
      `SELECT p.name
         FROM companies c
         INNER JOIN persons p ON p.id = c.person_id
        WHERE c.id = $1 AND c.tenant_id = $2
        LIMIT 1`,
      [agg.companyId, tenantId],
    )
    const companyName = companyRow.rows[0]?.name ?? `Filial ${agg.companyId.slice(0, 8)}`

    // Dynamic import pra não puxar @react-pdf/renderer no edge runtime
    const { renderMemorialPdf } = await import('./memorial-pdf')
    const buffer = await renderMemorialPdf({
      yearMonth: agg.yearMonth,
      companyName,
      taxRegime: agg.taxRegime,
      receitaServicosCents: agg.receitaServicosCents,
      receitaMercadoriasCents: agg.receitaMercadoriasCents,
      receitaTotalCents: agg.receitaTotalCents,
      rbt12Cents: agg.rbt12Cents,
      aliquotaEfetivaBp: agg.aliquotaEfetivaBp,
      impostoApuradoCents: agg.impostoApuradoCents,
      memorial:
        (agg.memorial as Array<{
          step: number
          label: string
          formula?: string
          valueCents?: number
          note?: string
        }>) ?? [],
      breakdown: breakdownRows.map((b) => ({
        emissionKind: b.emissionKind,
        count: b.count,
        totalCents: b.totalCents,
      })),
      closedAt: agg.closedAt?.toISOString() ?? null,
      generatedAt: new Date().toISOString(),
    })

    setAuditResource(agg.id, { kind: 'memorial_pdf_export', year_month: agg.yearMonth })

    return {
      ok: true as const,
      base64: buffer.toString('base64'),
      filename: `apuracao-${agg.yearMonth}.pdf`,
      mimeType: 'application/pdf',
    }
  },
)
