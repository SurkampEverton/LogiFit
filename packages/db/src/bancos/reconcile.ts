/**
 * Motor de conciliação — Sprint 17 Faixa B.
 *
 * 2 estratégias combinadas:
 *
 *   1. **Rules declarativas** (`reconciliation_rules.condition jsonb`) — aplica
 *      a primeira regra cuja condition match a transação. Ordem: `priority asc`.
 *   2. **Similarity match** (heurística) — para AP/AR sem rule matching, calcula
 *      score `value_proximity × date_proximity × description_overlap` e sugere
 *      top-3 candidatos.
 *
 * Função pura — não toca DB. Server Actions consomem.
 */

import { z } from 'zod'

// ─── Rule condition DSL ──────────────────────────────────────────────────

export const RuleConditionSchema = z.object({
  descriptionContains: z.string().optional(),
  descriptionRegex: z.string().optional(),
  amountMinCents: z.number().int().optional(),
  amountMaxCents: z.number().int().optional(),
  /** "negative" = saída, "positive" = entrada */
  amountSign: z.enum(['negative', 'positive', 'any']).optional(),
  /** YYYY-MM-DD ranges (inclusivos) */
  postedFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  postedTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

export type RuleCondition = z.infer<typeof RuleConditionSchema>

export type ReconciliationAction =
  | 'auto_match_ap'
  | 'auto_match_ar'
  | 'auto_create_entry'
  | 'flag_for_review'

export interface RuleRow {
  id: string
  name: string
  priority: number
  condition: unknown
  action: ReconciliationAction
  targetSupplierId: string | null
  targetChartAccountId: string | null
  targetCompanyId: string | null
  active: boolean
}

export interface TransactionInput {
  id: string
  amountCents: number
  description: string
  /** ISO datetime */
  postedAt: string
}

/**
 * Aplica rules sobre uma transação. Retorna a 1ª que casa ordenada por
 * `priority asc` (menor priority = mais específica = prevalece).
 */
export function matchRules(tx: TransactionInput, rules: RuleRow[]): RuleRow | null {
  const sorted = rules
    .filter((r) => r.active)
    .slice()
    .sort((a, b) => a.priority - b.priority)
  for (const rule of sorted) {
    if (conditionMatches(tx, rule.condition)) return rule
  }
  return null
}

export function conditionMatches(tx: TransactionInput, conditionRaw: unknown): boolean {
  let cond: RuleCondition
  try {
    cond = RuleConditionSchema.parse(conditionRaw)
  } catch {
    return false
  }

  if (cond.descriptionContains) {
    if (!tx.description.toLowerCase().includes(cond.descriptionContains.toLowerCase())) {
      return false
    }
  }
  if (cond.descriptionRegex) {
    try {
      const re = new RegExp(cond.descriptionRegex, 'i')
      if (!re.test(tx.description)) return false
    } catch {
      return false
    }
  }
  if (cond.amountMinCents != null && Math.abs(tx.amountCents) < cond.amountMinCents) {
    return false
  }
  if (cond.amountMaxCents != null && Math.abs(tx.amountCents) > cond.amountMaxCents) {
    return false
  }
  if (cond.amountSign === 'negative' && tx.amountCents >= 0) return false
  if (cond.amountSign === 'positive' && tx.amountCents <= 0) return false
  if (cond.postedFrom) {
    if (tx.postedAt.slice(0, 10) < cond.postedFrom) return false
  }
  if (cond.postedTo) {
    if (tx.postedAt.slice(0, 10) > cond.postedTo) return false
  }
  return true
}

// ─── Similarity matching (heurística) ────────────────────────────────────

export interface PaymentCandidate {
  id: string
  /** AP ou AR */
  kind: 'ap' | 'ar'
  /** Valor líquido a pagar/receber */
  amountCents: number
  /** Data de vencimento (YYYY-MM-DD) */
  dueDate: string
  /** Descrição/doc para comparar */
  description: string | null
  supplierName?: string | null
  payerName?: string | null
}

export interface MatchSuggestion {
  candidate: PaymentCandidate
  /** 0 - 1.0; quanto maior melhor */
  score: number
  reasons: string[]
}

/**
 * Sugere top-N candidatos por similaridade. Score combina:
 *   - Proximidade de valor (peso 0.5 — bate exato = 1.0, diff 1% = 0.95, etc)
 *   - Proximidade de data (peso 0.3 — mesmo dia = 1.0, ±7d = 0.7)
 *   - Match parcial de descrição/supplier (peso 0.2 — tokens em comum)
 *
 * Apenas pares **com mesmo sinal** competem:
 *   - tx negativa (saída) → candidatos AP (saída prevista)
 *   - tx positiva (entrada) → candidatos AR (entrada prevista)
 */
export function suggestMatches(
  tx: TransactionInput,
  candidates: PaymentCandidate[],
  options: { maxResults?: number; minScore?: number } = {},
): MatchSuggestion[] {
  const max = options.maxResults ?? 3
  const minScore = options.minScore ?? 0.3
  const txValueAbs = Math.abs(tx.amountCents)
  const txIsOutgoing = tx.amountCents < 0
  const txDate = tx.postedAt.slice(0, 10)

  const filtered = candidates.filter((c) => {
    if (txIsOutgoing && c.kind !== 'ap') return false
    if (!txIsOutgoing && c.kind !== 'ar') return false
    return true
  })

  const scored: MatchSuggestion[] = []
  for (const c of filtered) {
    const reasons: string[] = []

    // Valor (peso 0.5)
    const valueDiff = Math.abs(c.amountCents - txValueAbs)
    const valueScore =
      txValueAbs === 0
        ? 0
        : valueDiff === 0
          ? 1.0
          : Math.max(0, 1 - valueDiff / Math.max(txValueAbs, c.amountCents))
    if (valueScore >= 0.99) reasons.push('valor idêntico')
    else if (valueScore >= 0.9) reasons.push('valor próximo')

    // Data (peso 0.3)
    const daysDiff = daysBetween(txDate, c.dueDate)
    const dateScore = daysDiff === 0 ? 1.0 : Math.max(0, 1 - Math.abs(daysDiff) / 14)
    if (daysDiff === 0) reasons.push('mesma data')
    else if (Math.abs(daysDiff) <= 3) reasons.push(`±${Math.abs(daysDiff)}d da data`)

    // Descrição (peso 0.2)
    const partyName = c.supplierName ?? c.payerName ?? ''
    const txDesc = tx.description.toLowerCase()
    const ctxText = `${c.description ?? ''} ${partyName}`.toLowerCase()
    const overlap = computeTokenOverlap(txDesc, ctxText)
    if (overlap >= 0.5) reasons.push('descrição match')

    const score = valueScore * 0.5 + dateScore * 0.3 + overlap * 0.2
    if (score >= minScore) {
      scored.push({ candidate: c, score, reasons })
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, max)
}

function daysBetween(d1: string, d2: string): number {
  const t1 = new Date(d1 + 'T00:00:00Z').getTime()
  const t2 = new Date(d2 + 'T00:00:00Z').getTime()
  return Math.round((t1 - t2) / (24 * 60 * 60 * 1000))
}

function computeTokenOverlap(a: string, b: string): number {
  const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'e', 'em', 'para'])
  const tokensA = a.split(/[\s\-_\/\.\,]+/).filter((t) => t.length >= 3 && !STOP.has(t))
  const tokensB = b.split(/[\s\-_\/\.\,]+/).filter((t) => t.length >= 3 && !STOP.has(t))
  if (tokensA.length === 0 || tokensB.length === 0) return 0
  const setB = new Set(tokensB)
  const common = tokensA.filter((t) => setB.has(t)).length
  return common / Math.max(tokensA.length, tokensB.length)
}
