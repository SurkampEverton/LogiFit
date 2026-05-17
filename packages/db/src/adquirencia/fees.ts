/**
 * Calculadora de taxas + split de franquia — Sprint 18 Faixa B.1.
 *
 * Funções puras (sem DB) — Server Action passa dados já carregados.
 *
 * **Split em franquia** (consome `franchise_agreements` Sprint 01b regra 25):
 *   - Venda capturada em filial franqueada credita % na matriz conforme acordo.
 *   - Saída: lista de `IntercompanyEntryDraft` que vão pra Sprint 16
 *     `intercompany_entries` quando settle confirmar.
 *   - Regra 25: split clínico **NÃO ATRAVESSA company** em franquia — receita
 *     financeira sim, mas atendimento permanece na unit que capturou.
 */

import { z } from 'zod'

// ─── Custo real por venda ────────────────────────────────────────────────

export interface SaleCostInput {
  grossAmountCents: number
  cardKind: 'credit' | 'debit' | 'voucher' | 'pix' | 'other'
  installments: number
  /** Taxa nominal MDR % (ex: 2.99 = 2.99% sobre gross). */
  feeRatePct: number
  /** Tarifa fixa por transação em centavos (algumas adquirências cobram extra ~R$0,10-0,40). */
  flatFeeCents?: number
}

export interface SaleCostBreakdown {
  /** Bruto cobrado do cartão */
  grossCents: number
  /** Taxa percentual aplicada ao gross */
  percentFeeCents: number
  /** Tarifa fixa por transação */
  flatFeeCents: number
  /** Total descontado */
  totalFeeCents: number
  /** Líquido a receber */
  netCents: number
  /** Margem efetiva (1 - totalFee/gross) */
  netMarginPct: number
}

/**
 * Decompõe uma venda em custos. Garante consistência net = gross - totalFee.
 */
export function computeSaleCost(input: SaleCostInput): SaleCostBreakdown {
  const flat = input.flatFeeCents ?? 0
  const percentFee = Math.round((input.grossAmountCents * input.feeRatePct) / 100)
  const totalFee = percentFee + flat
  const net = input.grossAmountCents - totalFee
  const margin =
    input.grossAmountCents === 0 ? 0 : 1 - totalFee / input.grossAmountCents
  return {
    grossCents: input.grossAmountCents,
    percentFeeCents: percentFee,
    flatFeeCents: flat,
    totalFeeCents: totalFee,
    netCents: net,
    netMarginPct: Number((margin * 100).toFixed(2)),
  }
}

// ─── Antecipação ─────────────────────────────────────────────────────────

export interface AnticipationQuoteInput {
  /** Valor original a receber em centavos (somatório das vendas elegíveis). */
  originalAmountCents: number
  /** Dias entre solicitação e settlement original (ponderado se múltiplas vendas). */
  daysToOriginalSettlement: number
  /** Taxa de antecipação % a.m. (default 1.99 — padrão Stone/Cielo 2024). */
  monthlyRatePct?: number
}

export interface AnticipationQuote {
  originalCents: number
  feeCents: number
  anticipatedCents: number
  effectiveRatePct: string
  daysSaved: number
}

/**
 * Cota antecipação simples: `fee = original × (rate% × dias/30)`.
 * Para apresentar ao gerente antes de confirmar.
 */
export function quoteAnticipation(input: AnticipationQuoteInput): AnticipationQuote {
  const monthlyPct = input.monthlyRatePct ?? 1.99
  const days = Math.max(0, input.daysToOriginalSettlement)
  const ratePctEffective = (monthlyPct * days) / 30
  const fee = Math.round((input.originalAmountCents * ratePctEffective) / 100)
  const anticipated = input.originalAmountCents - fee
  return {
    originalCents: input.originalAmountCents,
    feeCents: fee,
    anticipatedCents: anticipated,
    effectiveRatePct: ratePctEffective.toFixed(2),
    daysSaved: days,
  }
}

// ─── Split de franquia ───────────────────────────────────────────────────

export const FranchiseAgreementSchema = z.object({
  /** UUID do acordo */
  id: z.string().uuid(),
  /** Company franqueadora (matriz) */
  franchisorCompanyId: z.string().uuid(),
  /** Company franqueada (filial) */
  franchiseeCompanyId: z.string().uuid(),
  /** % de royalty sobre receita financeira (0-100). */
  royaltyPct: z.number().min(0).max(100),
  /** % de taxa de marketing/publicidade compartilhada (0-100). */
  marketingPct: z.number().min(0).max(100).default(0),
  active: z.boolean().default(true),
})

export type FranchiseAgreement = z.infer<typeof FranchiseAgreementSchema>

export interface IntercompanyEntryDraft {
  /** Direção do lançamento: franqueada DEVE pra franqueadora */
  fromCompanyId: string
  toCompanyId: string
  amountCents: number
  kind: 'royalty' | 'marketing'
  /** Memo amigável pra UI */
  description: string
}

/**
 * Aplica split sobre o líquido recebido. Royalty + marketing são calculados
 * sobre `netAmountCents` (a receita efetivamente recebida).
 *
 * Se nenhum acordo ativo bater, retorna array vazio (venda fica integralmente
 * com a franqueada).
 *
 * **Regra 25:** este split é puramente financeiro. NÃO move atendimento
 * clínico nem altera member_company. Apenas ledger intercompany (Sprint 16).
 */
export function splitFranchiseSale(input: {
  netAmountCents: number
  capturedAtCompanyId: string
  agreements: FranchiseAgreement[]
  saleDescription: string
}): IntercompanyEntryDraft[] {
  const agg = input.agreements.find(
    (a) => a.active && a.franchiseeCompanyId === input.capturedAtCompanyId,
  )
  if (!agg) return []
  const out: IntercompanyEntryDraft[] = []
  if (agg.royaltyPct > 0) {
    const royaltyCents = Math.round((input.netAmountCents * agg.royaltyPct) / 100)
    if (royaltyCents > 0) {
      out.push({
        fromCompanyId: agg.franchiseeCompanyId,
        toCompanyId: agg.franchisorCompanyId,
        amountCents: royaltyCents,
        kind: 'royalty',
        description: `Royalty ${agg.royaltyPct}% — ${input.saleDescription}`,
      })
    }
  }
  if (agg.marketingPct > 0) {
    const mktCents = Math.round((input.netAmountCents * agg.marketingPct) / 100)
    if (mktCents > 0) {
      out.push({
        fromCompanyId: agg.franchiseeCompanyId,
        toCompanyId: agg.franchisorCompanyId,
        amountCents: mktCents,
        kind: 'marketing',
        description: `Marketing ${agg.marketingPct}% — ${input.saleDescription}`,
      })
    }
  }
  return out
}
