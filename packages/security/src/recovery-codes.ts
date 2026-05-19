/**
 * MFA recovery codes — Sprint 02b2 (ADR 0093 + regra 43).
 *
 * Quando paciente ativa MFA TOTP, gera 8-10 códigos one-time pra recovery
 * (caso perca celular). Cada código é hash-armazenado (mesmo padrão de
 * password); ao consumir, marca usado.
 *
 * **Format de cada code**: `XXXX-XXXX-XXXX` (12 chars + 2 hifens = 14 chars
 * total) — 12 chars base32 (alfabeto Crockford reduzido sem I/L/O/U pra
 * evitar confusão) → ~58 bits de entropia por code.
 *
 * **Storage**: jsonb array de `{hash, used_at}` cifrado via envelope
 * encryption (ADR 0073 — `LOGIFIT_DATA_KEY`). Sprint 02b2 implementa só
 * o generator/hasher; armazenamento cifrado em `passport_global_identities.
 * recovery_codes_encrypted` é responsabilidade do caller via envelope helpers.
 *
 * @example
 *   // No signup:
 *   const codes = generateRecoveryCodes(10)  // plain ['ABCD-EFGH-JKMN', ...]
 *   const codesPayload = codes.map((c) => ({ hash: hashRecoveryCode(c), used_at: null }))
 *   const encrypted = encryptJsonWithDataKey(codesPayload)
 *   // INSERT passport_global_identities (recovery_codes_encrypted, ...) VALUES ($1, ...)
 *
 *   // Display pro usuário (ÚNICA chance — print/save):
 *   showRecoveryCodes(codes)
 *
 *   // No recovery flow:
 *   const codes = decryptJsonWithDataKey(row.recovery_codes_encrypted)
 *   const idx = findUnusedMatchingCode(input, codes)
 *   if (idx < 0) throw UNAUTHORIZED
 *   codes[idx].used_at = new Date().toISOString()
 *   // UPDATE passport_global_identities SET recovery_codes_encrypted = ...
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

/** Alfabeto Crockford reduzido — 28 chars, sem I/L/O/U (evita confusão visual) */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'

/**
 * Gera 1 code formato `XXXX-XXXX-XXXX`. Cada bloco de 4 chars random
 * via crypto.randomInt (secure).
 */
function generateOneRecoveryCode(): string {
  const blocks: string[] = []
  for (let b = 0; b < 3; b++) {
    let block = ''
    for (let i = 0; i < 4; i++) {
      block += ALPHABET[randomInt(0, ALPHABET.length)]
    }
    blocks.push(block)
  }
  return blocks.join('-')
}

/**
 * Gera N recovery codes (default 10). Codes são únicos no batch.
 */
export function generateRecoveryCodes(n = 10): string[] {
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error('generateRecoveryCodes: n must be 1-50')
  }
  const seen = new Set<string>()
  while (seen.size < n) {
    seen.add(generateOneRecoveryCode())
  }
  return [...seen]
}

/**
 * Hash SHA-256 do code (após normalização — remove hifens + uppercase).
 * Codes têm entropia alta o suficiente pra dispensar bcrypt/scrypt
 * (cada code é one-time + tem ~58 bits aleatórios — não bruteforce-able
 * em janela de uso real).
 */
export function hashRecoveryCode(plain: string): string {
  const normalized = plain.replace(/-/g, '').toUpperCase().trim()
  return createHash('sha256').update(normalized).digest('hex')
}

/**
 * Constant-time comparison de plain code contra hash.
 */
export function verifyRecoveryCode(plain: string, hash: string): boolean {
  if (typeof plain !== 'string' || typeof hash !== 'string') return false
  const plainHash = hashRecoveryCode(plain)
  if (plainHash.length !== hash.length) return false
  return timingSafeEqual(Buffer.from(plainHash, 'hex'), Buffer.from(hash, 'hex'))
}

export interface RecoveryCodeEntry {
  hash: string
  /** ISO timestamp quando code foi consumido (null = disponível) */
  used_at: string | null
}

/**
 * Encontra index de code disponível que bate com `plainInput`.
 * Retorna -1 se nenhum bater ou todos forem `used_at != null`.
 *
 * Constant-time: itera todos os codes (não early-return) pra prevenir
 * timing-leak do número de codes restantes.
 */
export function findUnusedMatchingCode(plainInput: string, codes: RecoveryCodeEntry[]): number {
  if (typeof plainInput !== 'string' || codes.length === 0) return -1
  let matchIdx = -1
  for (let i = 0; i < codes.length; i++) {
    const entry = codes[i]!
    const isUsed = entry.used_at !== null
    const matches = verifyRecoveryCode(plainInput, entry.hash)
    // Mantém-se "olhando" todos os codes (constant-time): só atualiza idx
    // se ainda não temos match E o entry é unused E hash bate.
    if (matchIdx === -1 && !isUsed && matches) {
      matchIdx = i
    }
  }
  return matchIdx
}

/**
 * Marca code no index N como usado. Mutates copy (caller decide se persiste).
 */
export function markRecoveryCodeUsed(
  codes: RecoveryCodeEntry[],
  index: number,
): RecoveryCodeEntry[] {
  if (index < 0 || index >= codes.length) {
    throw new Error('markRecoveryCodeUsed: index out of range')
  }
  return codes.map((c, i) =>
    i === index ? { ...c, used_at: new Date().toISOString() } : c,
  )
}

/**
 * Conta quantos recovery codes ainda estão disponíveis (não-usados).
 * Útil pra alerta "menos de 3 codes restantes — regenere" no portal.
 */
export function countAvailableRecoveryCodes(codes: RecoveryCodeEntry[]): number {
  return codes.filter((c) => c.used_at === null).length
}
