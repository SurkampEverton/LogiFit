/**
 * TOTP (RFC 6238) — Sprint 02b3 (ADR 0094 §"MFA gate" + regra 43).
 *
 * Implementação standalone via `node:crypto` (HMAC-SHA1) — sem deps externas
 * (regra 46 — nova dep exigiria ADR). Compatível com Google Authenticator,
 * Authy, 1Password, Microsoft Authenticator, Bitwarden, Yubico Authenticator
 * (todos seguem RFC 6238 com defaults).
 *
 * **Parâmetros canônicos** (defaults compatíveis com authenticators):
 *   - Algorithm: HMAC-SHA1 (não SHA256/SHA512 — alguns apps não suportam)
 *   - Digits: 6
 *   - Period: 30 segundos
 *   - Secret: 20 bytes (160 bits) random → base32 sem padding (~32 chars)
 *   - Window: 1 (aceita código atual + 1 anterior + 1 posterior = ±30s drift)
 *
 * **Storage**: secret base32 cifrado via `encryptSecret` (envelope-crypto +
 * LOGIFIT_DATA_KEY ADR 0073) em `passport_global_identities.mfa_totp_secret_encrypted`.
 * Caller (Server Action wizard) cifra antes de gravar; decifra antes de verificar.
 *
 * **Constant-time comparison**: `verifyTotp` itera todos os steps no window
 * (não early-return) pra prevenir timing-leak.
 *
 * Uso típico:
 *   1. enrollTotp Server Action:
 *      const secret = generateTotpSecret()
 *      const uri = generateTotpUri(secret, email, 'LogiFit')
 *      // grava encryptSecret(secret) em passport_global_identities + retorna {secret, uri}
 *
 *   2. UI mostra QR (via lib client-side ou texto manual)
 *
 *   3. confirmTotp Server Action:
 *      const stored = decryptSecret(row.mfa_totp_secret_encrypted)
 *      if (!verifyTotp(token, stored)) throw UNAUTHORIZED
 *      // grava mfa_enrolled_at = now
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// ─── Base32 (RFC 4648) — sem padding (compatível com authenticators) ───

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const b of buf) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

function base32Decode(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) throw new Error(`base32Decode: invalid char '${char}'`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// ─── TOTP core ─────────────────────────────────────────────────────────

/**
 * Gera secret novo: 20 bytes random → base32 sem padding.
 * Padrão RFC 6238 + compatível com Google Authenticator (160 bits).
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/**
 * Computa token TOTP de 6 dígitos pro counter dado.
 * Padrão RFC 4226 HOTP com truncation dinâmica.
 *
 * `counter` = floor(unix_seconds / period). Pra TOTP atual:
 *   `counter = Math.floor(Date.now() / 1000 / 30)`
 */
function computeTotpToken(secretBase32: string, counter: number): string {
  const secret = base32Decode(secretBase32)
  // Counter como big-endian 8 bytes
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter), 0)

  const hmac = createHmac('sha1', secret).update(counterBuf).digest()

  // Dynamic truncation (RFC 4226 §5.3)
  const offset = hmac[hmac.length - 1]! & 0x0f
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff)

  const otp = binCode % 1_000_000
  return otp.toString().padStart(6, '0')
}

export interface VerifyTotpOptions {
  /** Janela de tolerância em steps (default 1 = ±30s drift) */
  window?: number
  /** Tempo Unix em ms (override pra testing). Default Date.now() */
  nowMs?: number
  /** Período em segundos (default 30 — padrão authenticators) */
  periodSec?: number
}

/**
 * Verifica token TOTP. Aceita window de ±N steps (default 1) pra absorver
 * drift de clock client/server. Constant-time comparison.
 *
 * Retorna `true` se token bate em qualquer step do window.
 */
export function verifyTotp(
  token: string,
  secretBase32: string,
  options: VerifyTotpOptions = {},
): boolean {
  if (typeof token !== 'string' || typeof secretBase32 !== 'string') return false
  if (!/^\d{6}$/.test(token)) return false

  const window = options.window ?? 1
  const period = options.periodSec ?? 30
  const nowMs = options.nowMs ?? Date.now()
  const currentStep = Math.floor(nowMs / 1000 / period)

  // Constant-time scan: gera todos os tokens válidos no window e compara
  // contra cada um (sem early-return mesmo se já achou match — anti-timing)
  let matchFound = false
  const tokenBuf = Buffer.from(token, 'utf8')
  for (let i = -window; i <= window; i++) {
    try {
      const expectedToken = computeTotpToken(secretBase32, currentStep + i)
      const expectedBuf = Buffer.from(expectedToken, 'utf8')
      if (
        expectedBuf.length === tokenBuf.length &&
        timingSafeEqual(expectedBuf, tokenBuf)
      ) {
        matchFound = true
      }
    } catch {
      // Secret base32 mal-formado — silently ignore (fail-closed via matchFound=false)
    }
  }
  return matchFound
}

/**
 * Gera URI otpauth:// pra ser exibida em QR code (apps authenticators escaneiam).
 * Formato: `otpauth://totp/{label}?secret={secret}&issuer={issuer}`
 *
 * Label é encoded como `{issuer}:{accountName}` (recomendação RFC 6238).
 *
 * @example
 *   generateTotpUri('JBSWY3DP...', 'paciente@example.com', 'LogiFit')
 *   // → otpauth://totp/LogiFit:paciente%40example.com?secret=JBSWY3DP...&issuer=LogiFit
 */
export function generateTotpUri(
  secretBase32: string,
  accountName: string,
  issuer: string = 'LogiFit',
): string {
  const label = `${issuer}:${accountName}`
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  })
  // encodeURIComponent preserva o : entre issuer e accountName? Não — encoda.
  // Authenticators aceitam tanto encoded quanto plain. Vou encoded pra ser
  // RFC-strict.
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}
