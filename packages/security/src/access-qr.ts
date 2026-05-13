/**
 * QR HMAC rotativo — Sprint 08 Faixa B (ADR 0017 esperado).
 *
 * Gera token assinado válido por 60s. Catraca lê QR via OCR e valida HMAC com
 * tolerância de 1 ciclo (member levanta QR, atrasa 30s → ainda OK).
 *
 * **Formato do token**: `{memberId}.{windowStart}.{hmac}` separado por ponto.
 *   - `memberId`: UUID do member
 *   - `windowStart`: timestamp Unix dividido por 60 (segundos / 60 = janela)
 *   - `hmac`: HMAC-SHA256(memberId + '|' + windowStart, secret) truncado 16 chars
 *
 * **Secret por tenant** (`access_secrets.secret`). Sprint 09+ envelope encryption
 * via `LOGIFIT_DATA_KEY`. MVP: secret é base64 32 bytes plain (visível só por
 * admin via JOIN em Server Action wrapped).
 *
 * **Validação**: catraca passa `tenantSecrets[]` (chave ativa + 1 anterior se
 * dentro de janela de rotação) e o helper testa todos.
 *
 * Sprint 09+: pode adicionar fingerprint do device do member (Web Auth API +
 * stored credential) pra anti-share de QR entre members.
 */
import { createHmac, randomBytes } from 'node:crypto'

const TOKEN_WINDOW_SECONDS = 60
const TOLERANCE_WINDOWS = 1 // aceita janela atual + 1 anterior

export interface AccessQrToken {
  memberId: string
  windowStart: number
  hmac: string
}

/**
 * Gera token assinado pra `memberId` válido na janela atual.
 * Retorna string `{memberId}.{windowStart}.{hmac}` pronto pra QR.
 */
export function generateAccessToken(memberId: string, secret: string): string {
  if (!memberId || !secret) {
    throw new Error('generateAccessToken: memberId e secret obrigatórios')
  }
  const windowStart = Math.floor(Date.now() / 1000 / TOKEN_WINDOW_SECONDS)
  const hmac = computeHmac(memberId, windowStart, secret)
  return `${memberId}.${windowStart}.${hmac}`
}

/**
 * Valida token contra N secrets ativos (chave atual + 1 anterior em rotação).
 * Retorna `{ valid: true, memberId }` se bate; `{ valid: false, reason }` se não.
 *
 * Tolerância: tenta janela atual + 1 anterior (`TOLERANCE_WINDOWS`).
 */
export function validateAccessToken(
  token: string,
  secrets: string[],
): { valid: true; memberId: string } | { valid: false; reason: string } {
  if (!token) return { valid: false, reason: 'empty_token' }
  const parts = token.split('.')
  if (parts.length !== 3) return { valid: false, reason: 'malformed' }
  const [memberId, windowStartStr, providedHmac] = parts
  if (!memberId || !windowStartStr || !providedHmac) {
    return { valid: false, reason: 'malformed' }
  }
  const windowStart = Number.parseInt(windowStartStr, 10)
  if (Number.isNaN(windowStart)) return { valid: false, reason: 'invalid_window' }

  const currentWindow = Math.floor(Date.now() / 1000 / TOKEN_WINDOW_SECONDS)
  // Aceita janela atual + 1 anterior (tolerância clock drift)
  if (windowStart < currentWindow - TOLERANCE_WINDOWS || windowStart > currentWindow) {
    return { valid: false, reason: 'expired_or_future' }
  }

  for (const secret of secrets) {
    if (!secret) continue
    const expectedHmac = computeHmac(memberId, windowStart, secret)
    if (timingSafeStringEqual(expectedHmac, providedHmac)) {
      return { valid: true, memberId }
    }
  }
  return { valid: false, reason: 'invalid_hmac' }
}

/**
 * Gera secret novo (32 bytes base64). Usado em `register_access_secret`
 * Server Action quando admin cria/roda tenant.
 */
export function generateAccessSecret(): string {
  return randomBytes(32).toString('base64')
}

function computeHmac(memberId: string, windowStart: number, secret: string): string {
  // secret vem base64 → buffer
  const key = Buffer.from(secret, 'base64')
  const data = `${memberId}|${windowStart}`
  return createHmac('sha256', key).update(data).digest('hex').slice(0, 16)
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
