/**
 * Tipos do motor de retenções tributárias — Sprint 15b (ADR 0061).
 *
 * Convenções (iguais ao resto do módulo fiscal):
 *   - Valores SEMPRE em centavos (bigint/number int)
 *   - Alíquotas SEMPRE em basis points (150 = 1,50%)
 *   - Nada de float pra dinheiro; arredondamento explícito na borda
 */

export type TaxKind = 'pis' | 'cofins' | 'csll' | 'irrf' | 'inss' | 'iss'

/** Alíquota fixa (PIS/COFINS/CSLL/IRRF PJ/ISS). */
export interface FixedRateRule {
  tax: TaxKind
  kind: 'fixed'
  /** Basis points — 150 = 1,50% */
  rateBp: number
  /**
   * Piso de dispensa: base abaixo disso não retém (Lei 10.833 art. 31 —
   * pagamento até R$ 10 não gera retenção federal).
   */
  minBaseCents?: number
  /** Retenção mínima: valor calculado abaixo disso é dispensado. */
  minAmountCents?: number
}

/** Faixa da tabela progressiva (IRRF PF). */
export interface ProgressiveBracket {
  /** Limite superior da faixa em centavos; null = última faixa (sem teto) */
  upToCents: number | null
  rateBp: number
  /** Parcela a deduzir do imposto apurado (mecânica da tabela RFB) */
  deductionCents: number
}

/** Tabela progressiva (IRRF PF — Tabela RFB vigente). */
export interface ProgressiveRateRule {
  tax: TaxKind
  kind: 'progressive'
  brackets: ProgressiveBracket[]
  /** Dedução por dependente (IRRF) — MVP não usa, fase 2 */
  perDependentDeductionCents?: number
}

/** Alíquota com teto de base (INSS — teto do salário de contribuição). */
export interface CappedRateRule {
  tax: TaxKind
  kind: 'capped'
  rateBp: number
  /** Base máxima: acima disso, retém sobre o teto (INSS) */
  maxBaseCents: number
}

export type RetentionRule = FixedRateRule | ProgressiveRateRule | CappedRateRule

/** Natureza tributária: conjunto de regras aplicáveis a um tipo de pagamento. */
export interface TaxNatureDefinition {
  code: string
  label: string
  appliesTo: 'ap' | 'professional_contract' | 'both'
  rules: RetentionRule[]
  regulatoryReference: string
}

export interface RetentionInput {
  /** Valor bruto do pagamento em centavos */
  grossCents: number
  nature: TaxNatureDefinition
  /**
   * ISS retido? Depende do município do tomador × prestador (LC 116 art. 3) —
   * decisão do operador/catálogo, não do motor. Alíquota vem do catálogo fiscal.
   */
  issRateBp?: number
  /** INSS já retido por outras fontes no mês (respeita o teto único) */
  inssAlreadyWithheldBaseCents?: number
}

export interface RetentionLine {
  tax: TaxKind
  baseCents: number
  /** Alíquota efetiva aplicada em basis points (progressiva → efetiva calculada) */
  rateAppliedBp: number
  amountCents: number
  /** false quando a regra existe mas a base não atingiu o piso */
  withheld: boolean
  note?: string
}

export interface RetentionResult {
  grossCents: number
  lines: RetentionLine[]
  totalRetainedCents: number
  netCents: number
}
