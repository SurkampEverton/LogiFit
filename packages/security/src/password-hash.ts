/**
 * Password hashing — scrypt Node nativo (Sprint 02b2 — ADR 0093).
 *
 * Usado pra hash de senha em `passport_global_identities` (paciente Path B).
 * Separado de BetterAuth (staff) — ADR 0092 mantém BetterAuth pra `users`
 * com Argon2id interno; passport global tem sua própria infraestrutura de
 * auth com scrypt nativo (sem dependência nova).
 *
 * **scrypt parameters** (OWASP recommendation 2024):
 *   - N (cost) = 16384 (2^14) — equilibra segurança vs latência em VPS
 *   - r (block size) = 8
 *   - p (parallel) = 1
 *   - keylen = 64 bytes (512 bits)
 *   - salt = 32 bytes random per password
 *
 * Memória: ~2 MB por hash (N×r×128). Tempo: ~50-100ms em VPS Oracle ARM.
 * Resistente a GPU/ASIC vs bcrypt (bcrypt usa SHA-only).
 *
 * **Format**: `scrypt$N$r$p$salt_b64$hash_b64` (compatível com PassLib).
 *
 * @example
 *   const hash = await hashPassword('senha-do-usuario')
 *   // Guarda hash em passport_global_identities.password_hash
 *
 *   const ok = await verifyPassword('senha-tentativa', hash)
 *   if (!ok) throw UNAUTHORIZED
 */

import { promisify } from 'node:util'
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 64
const SALT_LEN = 32
// maxmem padrão é 32MB; scrypt com N=16384,r=8,p=1 usa ~16MB — passa.
const MAX_MEM = 64 * 1024 * 1024

/**
 * Hash de senha plain → string format `scrypt$N$r$p$salt_b64$hash_b64`.
 *
 * Pure (sem efeito colateral). Cada chamada gera novo salt random.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('hashPassword: plain password must be non-empty string')
  }
  const salt = randomBytes(SALT_LEN)
  const derived = await scrypt(plain, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`
}

/**
 * Verifica plain password contra hash format `scrypt$N$r$p$salt$hash`.
 *
 * Constant-time comparison via `timingSafeEqual` (anti-timing-attack).
 * Retorna false silencioso pra hash mal-formatado (não vaza info de formato).
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (typeof plain !== 'string' || typeof hash !== 'string') return false
  const parts = hash.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const nParsed = Number.parseInt(parts[1]!, 10)
  const rParsed = Number.parseInt(parts[2]!, 10)
  const pParsed = Number.parseInt(parts[3]!, 10)
  const saltB64 = parts[4]!
  const expectedB64 = parts[5]!
  if (!Number.isFinite(nParsed) || !Number.isFinite(rParsed) || !Number.isFinite(pParsed)) {
    return false
  }
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltB64, 'base64')
    expected = Buffer.from(expectedB64, 'base64')
  } catch {
    return false
  }
  if (expected.length === 0) return false
  let derived: Buffer
  try {
    derived = await scrypt(plain, salt, expected.length, {
      N: nParsed,
      r: rParsed,
      p: pParsed,
      maxmem: MAX_MEM,
    })
  } catch {
    return false
  }
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

/**
 * Detecta se um hash precisa ser re-hashed (parameters fracos vs current).
 * Útil pra rotação gradual quando params são bumped (Sprint futuro pode
 * subir N=32768 quando hardware avança).
 *
 * Retorna `true` se hash usa N < current, false se está alinhado.
 */
export function needsRehash(hash: string): boolean {
  const parts = hash.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true
  const n = Number.parseInt(parts[1]!, 10)
  return !Number.isFinite(n) || n < SCRYPT_N
}
