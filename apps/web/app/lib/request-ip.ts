/**
 * `getClientIp()` — resolve IP do cliente em Server Actions / Route Handlers.
 *
 * Ordem de precedência (mais confiável → menos):
 *   1. `cf-connecting-ip` — Cloudflare proxy (regra 35 + 36) — fonte autoritativa
 *      quando atrás de Cloudflare; impossível spoofar via header.
 *   2. `x-real-ip` — Caddy/nginx reverse proxy.
 *   3. `x-forwarded-for` — fallback genérico, pega primeiro IP (cliente origem).
 *   4. `unknown` — sem header (ambiente local sem proxy). Sentinel pra audit
 *      sem quebrar gate de rate limit.
 *
 * **Spoofing**: em produção Cloudflare proxy, `cf-connecting-ip` é injetado
 * pelo CF e não pode ser sobrescrito pelo cliente. `x-forwarded-for` é
 * cliente-controlado em deployments sem proxy — usar apenas como fallback.
 *
 * Caller pode pré-resolver para evitar `await headers()` em hot loops:
 *   const ip = await getClientIp()
 *   await recordAuthAttempt({ ip, ... })
 */
import { headers } from 'next/headers'

export const UNKNOWN_IP = 'unknown'

export async function getClientIp(): Promise<string> {
  const h = await headers()
  const cf = h.get('cf-connecting-ip')
  if (cf && cf.length > 0) return cf
  const real = h.get('x-real-ip')
  if (real && real.length > 0) return real
  const xff = h.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first && first.length > 0) return first
  }
  return UNKNOWN_IP
}

/**
 * Versão sync que aceita Headers pré-resolvido — útil em API Routes onde
 * Request já está disponível.
 */
export function getClientIpFromHeaders(h: Headers): string {
  const cf = h.get('cf-connecting-ip')
  if (cf && cf.length > 0) return cf
  const real = h.get('x-real-ip')
  if (real && real.length > 0) return real
  const xff = h.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first && first.length > 0) return first
  }
  return UNKNOWN_IP
}
