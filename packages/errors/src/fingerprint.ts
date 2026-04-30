/**
 * Fingerprint para dedup de erros em system_alerts (ADR 0071 + regra 33).
 * SHA-256 com tenant_id pra evitar colisão multi-tenant — o mesmo erro em
 * tenants diferentes vira dois alerts separados.
 *
 * Roda em Node runtime (server actions / API routes / jobs). NÃO usar em
 * Edge runtime (middleware) — node:crypto não existe lá; o middleware tem
 * seu próprio request_id via globalThis.crypto.randomUUID().
 */
import { createHash } from 'node:crypto'

export function fingerprint(parts: {
  code: string
  module: string
  tenantId?: string
  signal?: string
}): string {
  const hash = createHash('sha256')
  hash.update(parts.code)
  hash.update('\0')
  hash.update(parts.module)
  hash.update('\0')
  hash.update(parts.tenantId ?? 'global')
  hash.update('\0')
  hash.update(parts.signal ?? '')
  return hash.digest('hex').slice(0, 16)
}
