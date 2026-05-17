/**
 * Calculator de rateio — Sprint 16 Faixa B (ADR 0036).
 *
 * Pure function `distribute({amount, rule, context})` retorna array
 * `[{companyId, amountCents, percentApplied}]`.
 *
 * **Garantia de soma exata:** rounding distributes resto para a primeira
 * company da lista (em ordem do distribution). Isso evita perda de centavos
 * — soma final dos amountCents = amount de entrada.
 *
 * **6 kinds suportados:**
 *   - `fixed` — distribution = [{companyId, percent}, ...]; soma percent = 100
 *   - `proportional` — distribution = [{companyId, weight}, ...]; percent = weight/total*100
 *   - `per_unit` — distribution = [{companyId}, ...]; context.unitsByCompany dá peso
 *   - `by_revenue` — context.revenueByCompany; pesos = revenue/total
 *   - `by_headcount` — context.headcountByCompany; pesos = count/total
 *   - `custom` — distribution livre tipo fixed; usado para casos especiais
 */

import { z } from 'zod'

// ─── Zod DSL ─────────────────────────────────────────────────────────────

export const FixedDistributionItemSchema = z.object({
  companyId: z.string().uuid(),
  percent: z.number().min(0).max(100),
})

export const ProportionalDistributionItemSchema = z.object({
  companyId: z.string().uuid(),
  weight: z.number().min(0),
})

export const SimpleCompanyItemSchema = z.object({
  companyId: z.string().uuid(),
})

export const AllocationRuleKindSchema = z.enum([
  'fixed',
  'proportional',
  'per_unit',
  'by_revenue',
  'by_headcount',
  'custom',
])

export type AllocationRuleKind = z.infer<typeof AllocationRuleKindSchema>

// ─── Tipos públicos ──────────────────────────────────────────────────────

export interface DistributeInput {
  amountCents: number
  rule: {
    kind: AllocationRuleKind
    distribution: unknown
  }
  /**
   * Contexto necessário para rules dinâmicas. Opcional para kinds estáticos.
   *   - per_unit → `unitsByCompany`
   *   - by_revenue → `revenueByCompany`
   *   - by_headcount → `headcountByCompany`
   */
  context?: {
    unitsByCompany?: Record<string, number>
    revenueByCompany?: Record<string, number>
    headcountByCompany?: Record<string, number>
  }
}

export interface AllocationOutput {
  companyId: string
  amountCents: number
  /** % aplicado, com até 4 casas decimais (precisão do schema numeric(7,4)). */
  percentApplied: number
}

export interface DistributeResult {
  allocations: AllocationOutput[]
  /** Snapshot do contexto usado — gravado em ap_allocations.context_snapshot. */
  contextSnapshot: Record<string, unknown> | null
}

// ─── Helpers internos ────────────────────────────────────────────────────

function roundCents(n: number): number {
  return Math.round(n)
}

function roundPercent(n: number): number {
  return Math.round(n * 10_000) / 10_000 // 4 casas decimais
}

/**
 * Aplica pesos (weights) sobre amountCents e devolve allocations com soma
 * exatamente igual ao amount. Resto vai pra primeira company.
 */
function distributeByWeights(
  amountCents: number,
  items: Array<{ companyId: string; weight: number }>,
): AllocationOutput[] {
  const totalWeight = items.reduce((s, i) => s + i.weight, 0)
  if (totalWeight <= 0 || items.length === 0) {
    return []
  }
  let distributed = 0
  const out: AllocationOutput[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const percent = (item.weight / totalWeight) * 100
    const allocated =
      i < items.length - 1
        ? roundCents((amountCents * item.weight) / totalWeight)
        : amountCents - distributed // última pega o resto pra soma bater
    distributed += allocated
    out.push({
      companyId: item.companyId,
      amountCents: allocated,
      percentApplied: roundPercent(percent),
    })
  }
  return out
}

// ─── distribute (main entry point) ───────────────────────────────────────

export function distribute(input: DistributeInput): DistributeResult {
  const { amountCents, rule, context } = input

  if (amountCents <= 0) {
    return { allocations: [], contextSnapshot: null }
  }

  switch (rule.kind) {
    case 'fixed':
    case 'custom': {
      // distribution = [{companyId, percent}]
      const parsed = z.array(FixedDistributionItemSchema).max(20).parse(rule.distribution)
      const sumPct = parsed.reduce((s, i) => s + i.percent, 0)
      if (Math.abs(sumPct - 100) > 0.001) {
        throw new Error(`Distribuição fixed deve somar 100%; soma=${sumPct}`)
      }
      const items = parsed.map((p) => ({ companyId: p.companyId, weight: p.percent }))
      return {
        allocations: distributeByWeights(amountCents, items),
        contextSnapshot: null,
      }
    }
    case 'proportional': {
      const parsed = z.array(ProportionalDistributionItemSchema).max(20).parse(rule.distribution)
      return {
        allocations: distributeByWeights(amountCents, parsed),
        contextSnapshot: null,
      }
    }
    case 'per_unit': {
      const parsed = z.array(SimpleCompanyItemSchema).max(20).parse(rule.distribution)
      const unitsBy = context?.unitsByCompany ?? {}
      const items = parsed.map((p) => ({
        companyId: p.companyId,
        weight: unitsBy[p.companyId] ?? 0,
      }))
      return {
        allocations: distributeByWeights(amountCents, items),
        contextSnapshot: { unitsByCompany: unitsBy },
      }
    }
    case 'by_revenue': {
      const parsed = z.array(SimpleCompanyItemSchema).max(20).parse(rule.distribution)
      const revBy = context?.revenueByCompany ?? {}
      const items = parsed.map((p) => ({
        companyId: p.companyId,
        weight: revBy[p.companyId] ?? 0,
      }))
      return {
        allocations: distributeByWeights(amountCents, items),
        contextSnapshot: { revenueByCompany: revBy },
      }
    }
    case 'by_headcount': {
      const parsed = z.array(SimpleCompanyItemSchema).max(20).parse(rule.distribution)
      const hcBy = context?.headcountByCompany ?? {}
      const items = parsed.map((p) => ({
        companyId: p.companyId,
        weight: hcBy[p.companyId] ?? 0,
      }))
      return {
        allocations: distributeByWeights(amountCents, items),
        contextSnapshot: { headcountByCompany: hcBy },
      }
    }
    default: {
      const exhaustive: never = rule.kind
      throw new Error(`Kind desconhecido: ${exhaustive as string}`)
    }
  }
}

// ─── validateRuleDistribution — usado em createAllocationRule ────────────

export function validateRuleDistribution(
  kind: AllocationRuleKind,
  distribution: unknown,
): { ok: true } | { ok: false; reason: string } {
  try {
    switch (kind) {
      case 'fixed':
      case 'custom': {
        const parsed = z.array(FixedDistributionItemSchema).min(1).max(20).parse(distribution)
        const sumPct = parsed.reduce((s, i) => s + i.percent, 0)
        if (Math.abs(sumPct - 100) > 0.001) {
          return { ok: false, reason: `Distribuição deve somar 100% (atual: ${sumPct})` }
        }
        return { ok: true }
      }
      case 'proportional': {
        const parsed = z.array(ProportionalDistributionItemSchema).min(1).max(20).parse(distribution)
        const totalWeight = parsed.reduce((s, i) => s + i.weight, 0)
        if (totalWeight <= 0) {
          return { ok: false, reason: 'Soma dos pesos deve ser > 0' }
        }
        return { ok: true }
      }
      case 'per_unit':
      case 'by_revenue':
      case 'by_headcount': {
        z.array(SimpleCompanyItemSchema).min(1).max(20).parse(distribution)
        return { ok: true }
      }
      default: {
        const exhaustive: never = kind
        return { ok: false, reason: `Kind desconhecido: ${exhaustive as string}` }
      }
    }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}
