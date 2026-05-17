/**
 * Calculadora DRE — Sprint 14 Faixa B.
 *
 * Estrutura canônica:
 * ```
 * {
 *   period: { from, to },
 *   revenue: { gross, paid, pending, refunded },
 *   costs: { by_category: [...], by_type: { fixed, variable }, total },
 *   margins: { gross, net },
 *   counts: { invoices, cost_entries }
 * }
 * ```
 *
 * **Lógica de receita** (Sprint 04):
 *   - Gross: sum(invoices.amount_cents) onde status='paid' no período (paid_at)
 *   - Pending: sum(invoices.amount_cents) onde status='pending'/'overdue' no período (due_at)
 *   - Refunded: sum onde status='refunded' (paid_at)
 *
 * **Lógica de custos** (Sprint 14):
 *   - Agrupado por category_id + by_type (fixed/variable)
 *   - Período por `incurred_at`
 *
 * **Margens:**
 *   - gross_margin = revenue.paid - costs.total
 *   - net_margin (Sprint 14 MVP) = gross_margin (sem ainda separar impostos/depreciação)
 *
 * **Pure function**: recebe arrays in-memory (invoices + cost_entries),
 * retorna estrutura. Não toca DB — caller (Server Action) faz as queries
 * via Drizzle e passa.
 *
 * **Lucratividade por procedimento** (sprint doc): adiada Sprint 14+ — depende
 * `invoice_items.service_type` que Sprint 04 não materializou ainda.
 */

export interface DreInvoiceRow {
  amountCents: number
  status: string
  paidAt: Date | null
  dueAt: Date
}

export interface DreCostEntryRow {
  amountCents: number
  categoryId: string
  categoryName: string
  categoryType: 'fixed' | 'variable'
  incurredAt: Date | string // ISO string OK
}

export interface DreResult {
  period: { from: Date; to: Date }
  revenue: {
    grossCents: number
    paidCents: number
    pendingCents: number
    overdueCents: number
    refundedCents: number
  }
  costs: {
    byCategory: Array<{
      categoryId: string
      categoryName: string
      categoryType: 'fixed' | 'variable'
      totalCents: number
      count: number
    }>
    byType: { fixedCents: number; variableCents: number }
    totalCents: number
  }
  margins: {
    grossCents: number // paid - costs.total
    grossPercent: number // gross / paid × 100
  }
  counts: { invoices: number; costEntries: number }
}

function inPeriod(at: Date | null, from: Date, to: Date): boolean {
  if (!at) return false
  return at >= from && at <= to
}

function toDate(v: Date | string): Date {
  return typeof v === 'string' ? new Date(v) : v
}

export function calculateDre(input: {
  period: { from: Date; to: Date }
  invoices: DreInvoiceRow[]
  costEntries: DreCostEntryRow[]
}): DreResult {
  const { from, to } = input.period

  // Receita: agrupa por status no período correto (paid_at vs due_at)
  let paidCents = 0
  let pendingCents = 0
  let overdueCents = 0
  let refundedCents = 0
  let invoicesInPeriod = 0
  for (const inv of input.invoices) {
    if (inv.status === 'paid' && inPeriod(inv.paidAt, from, to)) {
      paidCents += inv.amountCents
      invoicesInPeriod++
    } else if (inv.status === 'refunded' && inPeriod(inv.paidAt, from, to)) {
      refundedCents += inv.amountCents
      invoicesInPeriod++
    } else if (inv.status === 'pending' && inPeriod(inv.dueAt, from, to)) {
      pendingCents += inv.amountCents
      invoicesInPeriod++
    } else if (inv.status === 'overdue' && inPeriod(inv.dueAt, from, to)) {
      overdueCents += inv.amountCents
      invoicesInPeriod++
    }
  }
  const grossCents = paidCents + pendingCents + overdueCents

  // Custos: agrupa por categoria + tipo no período (incurred_at)
  const byCategoryMap = new Map<
    string,
    {
      categoryId: string
      categoryName: string
      categoryType: 'fixed' | 'variable'
      totalCents: number
      count: number
    }
  >()
  let fixedCents = 0
  let variableCents = 0
  let costEntriesInPeriod = 0
  for (const c of input.costEntries) {
    const incurredAt = toDate(c.incurredAt)
    if (!inPeriod(incurredAt, from, to)) continue
    costEntriesInPeriod++

    const existing = byCategoryMap.get(c.categoryId)
    if (existing) {
      existing.totalCents += c.amountCents
      existing.count++
    } else {
      byCategoryMap.set(c.categoryId, {
        categoryId: c.categoryId,
        categoryName: c.categoryName,
        categoryType: c.categoryType,
        totalCents: c.amountCents,
        count: 1,
      })
    }
    if (c.categoryType === 'fixed') fixedCents += c.amountCents
    else variableCents += c.amountCents
  }
  const totalCostsCents = fixedCents + variableCents
  const byCategory = Array.from(byCategoryMap.values()).sort(
    (a, b) => b.totalCents - a.totalCents,
  )

  // Margens
  const grossMarginCents = paidCents - totalCostsCents
  const grossPercent = paidCents > 0 ? (grossMarginCents / paidCents) * 100 : 0

  return {
    period: { from, to },
    revenue: {
      grossCents,
      paidCents,
      pendingCents,
      overdueCents,
      refundedCents,
    },
    costs: {
      byCategory,
      byType: { fixedCents, variableCents },
      totalCents: totalCostsCents,
    },
    margins: {
      grossCents: grossMarginCents,
      grossPercent: Math.round(grossPercent * 100) / 100,
    },
    counts: { invoices: invoicesInPeriod, costEntries: costEntriesInPeriod },
  }
}

// ─── Forecast heurístico ──────────────────────────────────────────────────
/**
 * Previsibilidade simples: projeta receita N meses com base em contratos
 * ativos + taxa de churn histórica.
 *
 * Fórmula (MVP):
 *   monthly_revenue_baseline = sum(plans.priceCents × contracts.active)
 *   churn_rate = N contratos cancelados últimos 6 meses / N ativos média
 *   projection[m] = baseline × (1 - churn_rate)^m
 *
 * Sprint 19 substitui por modelo preditivo (família A Gemini LLM ou família B
 * sklearn — ADR 0027).
 *
 * Pure function — caller passa baselines apurados via queries.
 */

export interface ForecastInput {
  /** Receita mensal recorrente atual (sum plans × contracts active) */
  baselineMonthlyCents: number
  /** Taxa mensal de churn (0-1). Ex: 0.05 = 5%/mês */
  monthlyChurnRate: number
  /** Número de meses à frente */
  monthsAhead: number
}

export interface ForecastResult {
  monthly: Array<{
    monthOffset: number
    projectedCents: number
    /** Margem de erro pessimista (-15%) e otimista (+10%) */
    lowCents: number
    highCents: number
  }>
  totalProjectedCents: number
}

export function forecastRevenue(input: ForecastInput): ForecastResult {
  if (
    input.baselineMonthlyCents < 0 ||
    input.monthlyChurnRate < 0 ||
    input.monthlyChurnRate > 1 ||
    input.monthsAhead < 1 ||
    input.monthsAhead > 36
  ) {
    return { monthly: [], totalProjectedCents: 0 }
  }
  const monthly: ForecastResult['monthly'] = []
  let total = 0
  for (let m = 1; m <= input.monthsAhead; m++) {
    const survivalRate = (1 - input.monthlyChurnRate) ** m
    const projected = Math.round(input.baselineMonthlyCents * survivalRate)
    const low = Math.round(projected * 0.85) // -15% pessimista
    const high = Math.round(projected * 1.1) // +10% otimista
    monthly.push({
      monthOffset: m,
      projectedCents: projected,
      lowCents: low,
      highCents: high,
    })
    total += projected
  }
  return { monthly, totalProjectedCents: total }
}
