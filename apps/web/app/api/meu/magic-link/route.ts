/**
 * POST /api/meu/magic-link — Sprint 26 Faixa C (26b).
 *
 * Endpoint público (sem auth). Aceita { email, tenantSlug, redirectTo? }.
 * Chama requestMagicLink (rate-limit + anti-enumeration). Resposta sempre 200
 * com { ok: true } pra evitar enumeration (mesmo se email não cadastrado).
 *
 * **Sem rate limit Redis aqui** (regra 36) — a Server Action `requestMagicLink`
 * já implementa rate limit por (memberId, 15min). Sprint 26c adiciona segundo
 * limit por IP via `packages/security/rate-limits.ts` (regra 36 completa).
 */
import { type NextRequest, NextResponse } from 'next/server'
import { requestMagicLink } from '../../../meu/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: true, sent: false }, { status: 200 })
  }

  const result = await requestMagicLink(body)
  return NextResponse.json(result, { status: 200 })
}
