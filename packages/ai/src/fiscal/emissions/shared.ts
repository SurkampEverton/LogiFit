/**
 * Helpers compartilhados dos payload builders Focus NFe — Sprint 36b (ADR 0059).
 *
 * Focus NFe API v2 trabalha com valores decimais em reais (não centavos) e
 * alíquotas em percentual. LogiFit armazena centavos (int) + basis points (int)
 * — conversão SEMPRE nestes helpers pra evitar drift de arredondamento espalhado.
 */

/** Converte centavos (int) → decimal reais com 2 casas (ex: 12345 → 123.45). */
export function centsToDecimal(cents: number): number {
  return Math.round(cents) / 100
}

/** Converte basis points (int) → percentual decimal (ex: 250 → 2.5). */
export function bpToPercent(bp: number): number {
  return Math.round(bp) / 100
}

/** Data de emissão no formato ISO date (YYYY-MM-DD) esperado pelo Focus. */
export function isoDate(date: Date): string {
  const iso = date.toISOString()
  const datePart = iso.split('T')[0]
  if (!datePart) throw new Error('isoDate: data inválida')
  return datePart
}

/**
 * Discrimina CPF (11 dígitos) vs CNPJ (14 dígitos) pra montar o campo correto
 * do payload. Focus rejeita quando ambos presentes.
 */
export function documentField(
  document: string,
  cpfKey: string,
  cnpjKey: string,
): Record<string, string> {
  const digits = document.replace(/\D/g, '')
  if (digits.length === 11) return { [cpfKey]: digits }
  if (digits.length === 14) return { [cnpjKey]: digits }
  throw new Error(
    `documento inválido: esperado CPF (11) ou CNPJ (14) dígitos, recebido ${digits.length}`,
  )
}
