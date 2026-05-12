/**
 * Validador de documento brasileiro (CPF/CNPJ) — algoritmo de dígito verificador.
 *
 * Lib zero — sem dependência externa. Algoritmo é padrão público (Receita Federal).
 *
 * Detecção automática pelo tamanho (regra do Sprint 01a):
 *   11 dígitos → CPF (PF)
 *   14 dígitos → CNPJ (PJ)
 *   demais    → invalid
 *
 * Uso típico:
 *   const result = parseDocument('123.456.789-09')
 *   if (result.ok) {
 *     // result.kind = 'pf' | 'pj'
 *     // result.normalized = '12345678909' (só dígitos)
 *   }
 */

export type PersonKind = 'pf' | 'pj'

export type ParseDocumentResult =
  | { ok: true; kind: PersonKind; normalized: string }
  | { ok: false; reason: ParseDocumentError }

export type ParseDocumentError =
  | 'empty'
  | 'invalid_length'
  | 'all_same_digit'
  | 'check_digit_mismatch'

/** Remove tudo que não é dígito. */
export function normalizeDocument(input: string): string {
  return (input ?? '').replace(/\D/g, '')
}

/** Detecta tipo pelo tamanho dos dígitos. */
export function detectKind(normalized: string): PersonKind | null {
  if (normalizedLength(normalized, 11)) return 'pf'
  if (normalizedLength(normalized, 14)) return 'pj'
  return null
}

function normalizedLength(s: string, n: number): boolean {
  return s.length === n
}

/**
 * Valida CPF (11 dígitos) via algoritmo módulo 11.
 *
 * Algoritmo (Receita Federal):
 *   1. Pega os 9 primeiros dígitos
 *   2. Multiplica por 10, 9, 8, ..., 2; soma
 *   3. resto = soma * 10 % 11; se resto == 10, vira 0 → primeiro dígito verificador
 *   4. Repete com 10 dígitos (mult 11..2) pro segundo dígito
 *
 * Rejeita também CPFs com todos dígitos iguais (111.111.111-11 etc.) — passariam
 * no algoritmo mas são inválidos por convenção.
 */
export function isValidCpf(cpfDigits: string): boolean {
  if (cpfDigits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpfDigits)) return false

  const calcDigit = (slice: string, weightStart: number): number => {
    let sum = 0
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * (weightStart - i)
    }
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }

  const d1 = calcDigit(cpfDigits.slice(0, 9), 10)
  if (d1 !== Number(cpfDigits[9])) return false
  const d2 = calcDigit(cpfDigits.slice(0, 10), 11)
  if (d2 !== Number(cpfDigits[10])) return false
  return true
}

/**
 * Valida CNPJ (14 dígitos) via algoritmo módulo 11.
 *
 * Algoritmo (Receita Federal):
 *   1. Pega os 12 primeiros dígitos
 *   2. Multiplica por [5,4,3,2,9,8,7,6,5,4,3,2]; soma
 *   3. resto = soma % 11; se < 2, vira 0 → primeiro dígito verificador
 *   4. Repete com 13 dígitos (peso [6,5,4,3,2,9,8,7,6,5,4,3,2]) pro segundo
 *
 * Rejeita CNPJs com todos dígitos iguais.
 */
export function isValidCnpj(cnpjDigits: string): boolean {
  if (cnpjDigits.length !== 14) return false
  if (/^(\d)\1{13}$/.test(cnpjDigits)) return false

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

  const calcDigit = (slice: string, weights: number[]): number => {
    let sum = 0
    for (let i = 0; i < slice.length; i++) {
      // noUncheckedIndexedAccess: ambos arrays têm length exatamente igual a slice.length
      // (precondição garantida pelos callers: weights1[12] pra slice[12], weights2[13] pra slice[13])
      const digit = slice[i] ?? '0'
      const weight = weights[i] ?? 0
      sum += Number(digit) * weight
    }
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }

  const d1 = calcDigit(cnpjDigits.slice(0, 12), weights1)
  if (d1 !== Number(cnpjDigits[12])) return false
  const d2 = calcDigit(cnpjDigits.slice(0, 13), weights2)
  if (d2 !== Number(cnpjDigits[13])) return false
  return true
}

/**
 * Detecta tipo + valida dígito verificador num único passo.
 * Use isso na boundary de Server Actions / Zod schemas / componentes de input.
 */
export function parseDocument(input: string): ParseDocumentResult {
  const normalized = normalizeDocument(input)
  if (normalized.length === 0) return { ok: false, reason: 'empty' }

  const kind = detectKind(normalized)
  if (kind === null) return { ok: false, reason: 'invalid_length' }

  if (/^(\d)\1+$/.test(normalized)) {
    return { ok: false, reason: 'all_same_digit' }
  }

  const valid = kind === 'pf' ? isValidCpf(normalized) : isValidCnpj(normalized)
  if (!valid) return { ok: false, reason: 'check_digit_mismatch' }

  return { ok: true, kind, normalized }
}

/**
 * Formata o documento (visual — sem alterar dado armazenado).
 *   CPF  → 123.456.789-09
 *   CNPJ → 12.345.678/0001-99
 *
 * Não tenta formatar valor parcial; retorna input cru se length não bate.
 */
export function formatDocument(normalized: string): string {
  if (normalized.length === 11) {
    return `${normalized.slice(0, 3)}.${normalized.slice(3, 6)}.${normalized.slice(6, 9)}-${normalized.slice(9)}`
  }
  if (normalized.length === 14) {
    return `${normalized.slice(0, 2)}.${normalized.slice(2, 5)}.${normalized.slice(5, 8)}/${normalized.slice(8, 12)}-${normalized.slice(12)}`
  }
  return normalized
}
