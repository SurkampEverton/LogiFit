/**
 * Heurística de match venda↔bank_transaction — Sprint 18 Faixa B.1.
 *
 * Aplica regras declarativas (`acquirer_reconciliation_rules.condition`) +
 * fallback similarity match. Análogo a `bancos/reconcile.ts` mas otimizado pra
 * settlement de maquininha (geralmente cai como crédito agregado D+N).
 *
 * **Estratégias combinadas:**
 *   1. Rules declarativas — match rápido por providerEquals/cardBrandEquals/
 *      amountMinCents/amountMaxCents/daysAfterSettlementMax
 *   2. Similarity heurística — value + date + description tokens
 *
 * Função pura — não toca DB.
 */
import { z } from 'zod'

// ─── Rule condition DSL ──────────────────────────────────────────────────

export const AcquirerRuleConditionSchema = z.object({
  providerEquals: z.enum(['cielo', 'stone', 'rede', 'getnet', 'pagseguro', 'mock']).optional(),
  cardBrandEquals: z.string().optional(),
  cardKindEquals: z.enum(['credit', 'debit', 'voucher', 'pix', 'other']).optional(),
  amountMinCents: z.number().int().optional(),
  amountMaxCents: z.number().int().optional(),
  /** Max dias entre `expected_settlement_date` e `bank_transaction.posted_at` para considerar match (default 2) */
  daysAfterSettlementMax: z.number().int().min(0).max(30).optional(),
  /** Match texto na descrição do bank_tx (ex: "STONE", "CIELO"). */
  bankDescriptionContains: z.string().optional(),
})

export type AcquirerRuleCondition = z.infer<typeof AcquirerRuleConditionSchema>

export interface AcquirerRuleRow {
  id: string
  name: string
  priority: number
  condition: unknown
  action: 'auto_match_bank' | 'flag_for_review'
  targetBankAccountId: string | null
  active: boolean
}

// ─── Input shapes ────────────────────────────────────────────────────────

export interface SaleInput {
  id: string
  provider: 'cielo' | 'stone' | 'rede' | 'getnet' | 'pagseguro' | 'mock'
  cardBrand: string | null
  cardKind: 'credit' | 'debit' | 'voucher' | 'pix' | 'other'
  /** Net (líquido a receber) em centavos */
  netAmountCents: number
  /** YYYY-MM-DD */
  expectedSettlementDate: string
  capturedAt: string
}

export interface BankTxInput {
  id: string
  /** Positivo = crédito (settlement entra) */
  amountCents: number
  /** ISO datetime */
  postedAt: string
  description: string
  bankAccountId: string
}

// ─── Rule matching ───────────────────────────────────────────────────────

/**
 * Retorna a primeira rule cuja `condition` casa (priority asc). Quando há
 * `bankTx`, valida também `bankDescriptionContains` + `daysAfterSettlementMax`
 * + `targetBankAccountId`. Quando `bankTx` é null, valida só campos de venda.
 */
export function matchAcquirerRules(
  sale: SaleInput,
  rules: AcquirerRuleRow[],
  bankTx?: BankTxInput,
): AcquirerRuleRow | null {
  const sorted = rules.filter((r) => r.active).slice().sort((a, b) => a.priority - b.priority)
  for (const rule of sorted) {
    if (ruleConditionMatches(sale, rule, bankTx)) return rule
  }
  return null
}

export function ruleConditionMatches(
  sale: SaleInput,
  rule: AcquirerRuleRow,
  bankTx?: BankTxInput,
): boolean {
  let cond: AcquirerRuleCondition
  try {
    cond = AcquirerRuleConditionSchema.parse(rule.condition)
  } catch {
    return false
  }

  if (cond.providerEquals && cond.providerEquals !== sale.provider) return false
  if (
    cond.cardBrandEquals &&
    (sale.cardBrand ?? '').toLowerCase() !== cond.cardBrandEquals.toLowerCase()
  ) {
    return false
  }
  if (cond.cardKindEquals && cond.cardKindEquals !== sale.cardKind) return false
  if (cond.amountMinCents != null && sale.netAmountCents < cond.amountMinCents) return false
  if (cond.amountMaxCents != null && sale.netAmountCents > cond.amountMaxCents) return false

  if (bankTx) {
    if (rule.targetBankAccountId && rule.targetBankAccountId !== bankTx.bankAccountId) return false
    if (cond.bankDescriptionContains) {
      if (
        !bankTx.description.toLowerCase().includes(cond.bankDescriptionContains.toLowerCase())
      ) {
        return false
      }
    }
    if (cond.daysAfterSettlementMax != null) {
      const days = daysBetween(sale.expectedSettlementDate, bankTx.postedAt.slice(0, 10))
      if (days < 0 || days > cond.daysAfterSettlementMax) return false
    }
  }
  return true
}

// ─── Similarity match (heurística top-N) ─────────────────────────────────

export interface MatchSuggestion {
  bankTx: BankTxInput
  /** 0 - 1.0; quanto maior melhor */
  score: number
  reasons: string[]
}

/**
 * Sugere top-N `bank_transactions` mais prováveis pra fechar com uma venda.
 *
 * Score combina:
 *   - Valor: peso 0.55 — settlement bate exato com net ou agregado de várias vendas
 *   - Data: peso 0.35 — D+settlement ± 3 dias
 *   - Descrição: peso 0.10 — bank_tx geralmente contém "STONE LIQUIDACAO",
 *     "CIELO DESCONTOS", etc; match parcial com provider name ajuda.
 *
 * Apenas transactions positivas (crédito) competem (settlement entra como
 * receita no banco).
 */
export function suggestSettlementMatches(
  sale: SaleInput,
  candidates: BankTxInput[],
  options: { maxResults?: number; minScore?: number; daysToleranceDays?: number } = {},
): MatchSuggestion[] {
  const max = options.maxResults ?? 3
  const minScore = options.minScore ?? 0.3
  const tolerance = options.daysToleranceDays ?? 5
  const saleDate = sale.expectedSettlementDate

  // Apenas créditos (positivos) competem
  const filtered = candidates.filter((c) => c.amountCents > 0)

  const scored: MatchSuggestion[] = []
  for (const c of filtered) {
    const reasons: string[] = []
    // Valor (peso 0.55)
    const valueDiff = Math.abs(c.amountCents - sale.netAmountCents)
    const valueScore =
      sale.netAmountCents === 0
        ? 0
        : valueDiff === 0
          ? 1.0
          : Math.max(0, 1 - valueDiff / Math.max(sale.netAmountCents, c.amountCents))
    if (valueScore >= 0.99) reasons.push('valor exato')
    else if (valueScore >= 0.9) reasons.push('valor próximo')

    // Data (peso 0.35)
    const days = daysBetween(saleDate, c.postedAt.slice(0, 10))
    const dateScore =
      days < 0
        ? 0 // settlement no banco antes da data esperada — improvável
        : days === 0
          ? 1.0
          : Math.max(0, 1 - Math.abs(days) / tolerance)
    if (days === 0) reasons.push('mesma data')
    else if (days > 0 && days <= 2) reasons.push(`D+${days} settlement`)

    // Descrição (peso 0.10) — match provider name
    const descLower = c.description.toLowerCase()
    let descScore = 0
    if (descLower.includes(sale.provider)) {
      descScore = 1
      reasons.push(`descrição menciona "${sale.provider}"`)
    } else {
      const hints = ['liquidacao', 'liquidação', 'settlement', 'cartao', 'cartão']
      if (hints.some((h) => descLower.includes(h))) {
        descScore = 0.5
        reasons.push('descrição típica de settlement')
      }
    }

    const score = valueScore * 0.55 + dateScore * 0.35 + descScore * 0.1
    if (score >= minScore) scored.push({ bankTx: c, score, reasons })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, max)
}

// ─── Detector de divergência ─────────────────────────────────────────────

/**
 * Identifica vendas com settlement esperado já passado há > N dias sem match.
 * Dispara alerta `acquirer.divergence_detected` em runtime.
 */
export function detectDivergences(
  sales: Array<SaleInput & { reconciledAt: string | null; actualSettlementDate: string | null }>,
  options: { today?: string; thresholdDays?: number } = {},
): Array<{ saleId: string; daysOverdue: number }> {
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const threshold = options.thresholdDays ?? 2
  const out: Array<{ saleId: string; daysOverdue: number }> = []
  for (const s of sales) {
    if (s.reconciledAt) continue
    if (s.actualSettlementDate) continue
    const days = daysBetween(s.expectedSettlementDate, today)
    if (days > threshold) {
      out.push({ saleId: s.id, daysOverdue: days })
    }
  }
  return out
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function daysBetween(from: string, to: string): number {
  const t1 = new Date(`${from}T00:00:00Z`).getTime()
  const t2 = new Date(`${to}T00:00:00Z`).getTime()
  return Math.round((t2 - t1) / (24 * 60 * 60 * 1000))
}
