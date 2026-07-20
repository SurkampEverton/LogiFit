/**
 * Calculadora de retenções tributárias — Sprint 15b (ADR 0061).
 *
 * Função pura e determinística: mesma entrada → mesma saída, sem I/O, sem
 * data implícita (a vigência das tabelas vem da natureza recebida). Testável
 * exaustivamente — é o coração do Grupo B/G do ADR 0061.
 *
 * **Arredondamento:** `Math.round` (meio pra cima) em centavos, aplicado UMA
 * vez por tributo — nunca acumulando erro entre linhas. É o comportamento que
 * o contador espera na conferência da DARF.
 */

import type {
  CappedRateRule,
  FixedRateRule,
  ProgressiveRateRule,
  RetentionInput,
  RetentionLine,
  RetentionResult,
  RetentionRule,
} from './types'

function calcFixed(rule: FixedRateRule, grossCents: number): RetentionLine {
  const minBase = rule.minBaseCents
  if (minBase !== undefined && grossCents < minBase) {
    return {
      tax: rule.tax,
      baseCents: grossCents,
      rateAppliedBp: rule.rateBp,
      amountCents: 0,
      withheld: false,
      note: `Base abaixo do piso de dispensa (R$ ${(minBase / 100).toFixed(2)})`,
    }
  }
  const amountCents = Math.round((grossCents * rule.rateBp) / 10000)
  if (rule.minAmountCents !== undefined && amountCents < rule.minAmountCents) {
    return {
      tax: rule.tax,
      baseCents: grossCents,
      rateAppliedBp: rule.rateBp,
      amountCents: 0,
      withheld: false,
      note: 'Valor calculado abaixo da retenção mínima',
    }
  }
  return {
    tax: rule.tax,
    baseCents: grossCents,
    rateAppliedBp: rule.rateBp,
    amountCents,
    withheld: amountCents > 0,
  }
}

function calcCapped(
  rule: CappedRateRule,
  grossCents: number,
  alreadyWithheldBaseCents: number,
): RetentionLine {
  // Teto é único no mês: base já retida por outras fontes consome o limite
  const remainingCeiling = Math.max(0, rule.maxBaseCents - alreadyWithheldBaseCents)
  const baseCents = Math.min(grossCents, remainingCeiling)
  const amountCents = Math.round((baseCents * rule.rateBp) / 10000)
  const capped = baseCents < grossCents
  return {
    tax: rule.tax,
    baseCents,
    rateAppliedBp: rule.rateBp,
    amountCents,
    withheld: amountCents > 0,
    note: capped ? `Base limitada ao teto (R$ ${(rule.maxBaseCents / 100).toFixed(2)})` : undefined,
  }
}

function calcProgressive(rule: ProgressiveRateRule, grossCents: number): RetentionLine {
  const bracket =
    rule.brackets.find((b) => b.upToCents === null || grossCents <= b.upToCents) ??
    rule.brackets[rule.brackets.length - 1]
  if (!bracket) {
    return {
      tax: rule.tax,
      baseCents: grossCents,
      rateAppliedBp: 0,
      amountCents: 0,
      withheld: false,
      note: 'Tabela progressiva vazia',
    }
  }
  const raw = Math.round((grossCents * bracket.rateBp) / 10000) - bracket.deductionCents
  const amountCents = Math.max(0, raw)
  // Alíquota EFETIVA (imposto / base) — o que o contador confere na guia
  const rateAppliedBp = grossCents > 0 ? Math.round((amountCents / grossCents) * 10000) : 0
  return {
    tax: rule.tax,
    baseCents: grossCents,
    rateAppliedBp,
    amountCents,
    withheld: amountCents > 0,
    note:
      amountCents === 0
        ? 'Faixa isenta da tabela progressiva'
        : `Faixa ${(bracket.rateBp / 100).toFixed(1)}% − dedução R$ ${(bracket.deductionCents / 100).toFixed(2)}`,
  }
}

function calcRule(rule: RetentionRule, input: RetentionInput): RetentionLine {
  switch (rule.kind) {
    case 'fixed':
      return calcFixed(rule, input.grossCents)
    case 'capped':
      return calcCapped(rule, input.grossCents, input.inssAlreadyWithheldBaseCents ?? 0)
    case 'progressive':
      return calcProgressive(rule, input.grossCents)
  }
}

/**
 * Calcula todas as retenções de um pagamento.
 *
 * ISS entra fora das regras da natureza porque a alíquota é municipal (vem do
 * `fiscal_service_catalog` do tenant) e a obrigação de reter depende do
 * município tomador × prestador (LC 116 art. 3) — decisão do operador.
 */
export function calculateRetentions(input: RetentionInput): RetentionResult {
  const lines = input.nature.rules.map((rule) => calcRule(rule, input))

  if (input.issRateBp !== undefined && input.issRateBp > 0) {
    const amountCents = Math.round((input.grossCents * input.issRateBp) / 10000)
    lines.push({
      tax: 'iss',
      baseCents: input.grossCents,
      rateAppliedBp: input.issRateBp,
      amountCents,
      withheld: amountCents > 0,
      note: 'ISS retido na fonte (LC 116/2003 art. 3)',
    })
  }

  const totalRetainedCents = lines.reduce((sum, l) => sum + l.amountCents, 0)
  return {
    grossCents: input.grossCents,
    lines,
    totalRetainedCents,
    netCents: input.grossCents - totalRetainedCents,
  }
}
