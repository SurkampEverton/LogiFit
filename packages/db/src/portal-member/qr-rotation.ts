/**
 * QR Rotation — Sprint 26 Faixa B.1.
 *
 * QR code de acesso na catraca (academia). Reusa HMAC do Sprint 08
 * (acesso/devices/secrets), mas a lib pura aqui calcula período de rotação
 * + payload.
 *
 * **Rotação a cada 60s** — paciente vê QR mudando visualmente no `/meu/qr`.
 * Servidor valida que payload é HMAC-SHA256(memberId + tenantId + window) com
 * secret partilhado por device.
 *
 * **Window** = floor(now / 60000) — janelas de 60s. Valida ±1 window (tolerância
 * relógio dessincronizado).
 */
import crypto from 'node:crypto'

export const QR_ROTATION_WINDOW_MS = 60_000 // 60s
export const QR_ACCEPTED_WINDOWS = 1 // ± 1 window tolerância

export interface QrPayload {
  memberId: string
  tenantId: string
  /** Window number (floor de now/60s) */
  window: number
  /** HMAC-SHA256 hex truncado pra 32 chars */
  signature: string
}

/**
 * Gera QR payload pro frontend exibir. Frontend regenera a cada 60s.
 */
export function generateQrPayload(input: {
  memberId: string
  tenantId: string
  secret: string
  now?: Date
}): QrPayload {
  const now = input.now ?? new Date()
  const window = Math.floor(now.getTime() / QR_ROTATION_WINDOW_MS)
  const message = `${input.memberId}.${input.tenantId}.${window}`
  const signature = crypto
    .createHmac('sha256', input.secret)
    .update(message)
    .digest('hex')
    .slice(0, 32)
  return { memberId: input.memberId, tenantId: input.tenantId, window, signature }
}

/**
 * Valida QR payload no servidor (catraca lê → API verifica).
 *
 * Aceita payload com window = atual, atual-1, atual+1 (tolerância relógio).
 * Recusa se signature não bate ou se window fora da janela.
 */
export function verifyQrPayload(input: {
  payload: QrPayload
  secret: string
  now?: Date
}): { ok: boolean; reason?: 'expired' | 'invalid_signature' } {
  const now = input.now ?? new Date()
  const currentWindow = Math.floor(now.getTime() / QR_ROTATION_WINDOW_MS)
  const delta = Math.abs(input.payload.window - currentWindow)
  if (delta > QR_ACCEPTED_WINDOWS) {
    return { ok: false, reason: 'expired' }
  }
  const message = `${input.payload.memberId}.${input.payload.tenantId}.${input.payload.window}`
  const expected = crypto
    .createHmac('sha256', input.secret)
    .update(message)
    .digest('hex')
    .slice(0, 32)
  if (
    expected.length !== input.payload.signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.payload.signature))
  ) {
    return { ok: false, reason: 'invalid_signature' }
  }
  return { ok: true }
}

/**
 * Encode pra string que o leitor de QR consegue ler.
 * Formato compacto: `LF|{memberId}|{tenantId}|{window}|{signature}`
 */
export function encodeQrString(payload: QrPayload): string {
  return `LF|${payload.memberId}|${payload.tenantId}|${payload.window}|${payload.signature}`
}

/**
 * Decode string lida pelo scanner.
 */
export function decodeQrString(s: string): QrPayload | null {
  if (!s.startsWith('LF|')) return null
  const parts = s.split('|')
  if (parts.length !== 5) return null
  const window = Number.parseInt(parts[3]!, 10)
  if (!Number.isInteger(window)) return null
  return {
    memberId: parts[1]!,
    tenantId: parts[2]!,
    window,
    signature: parts[4]!,
  }
}
