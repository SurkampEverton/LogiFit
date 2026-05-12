import { db } from '@repo/db/client'
/**
 * POST /api/jobs/process-grants-expired — cron handler (ADR 0019 + Sprint 01b D.6).
 *
 * Roda diariamente (03:15 UTC) chamando SQL function `process_grants_expired()`
 * que marca user_permission_grants vencidos com:
 *   - revoked_at = now()
 *   - revoked_reason = 'expired'
 *
 * `has_permission()` (policy 0013) já ignora grants com `expires_at<now()`
 * — esta function é "limpa-cosmética" para UI mostrar como expirado em vez
 * de ativo-mas-invisível.
 *
 * **Auth via `CRON_SECRET` env** (Authorization: Bearer <token>) — mesmo gate
 * canônico do process-trial-lifecycle (timingSafeEqual + Bearer).
 *
 * **Resposta** (envelope ADR 0071):
 *   200 { ok: true, data: { processed_at, newly_revoked, revoked_grant_ids[] } }
 *   401 { ok: false, error: { code: 'UNAUTHORIZED', ... } }
 *   500 { ok: false, error: { code: 'INTERNAL_ERROR', ... } }
 *
 * Idempotente — pode rodar várias vezes/dia sem efeito duplicado.
 */
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

interface GrantsExpiredResult {
  processed_at: string
  newly_revoked: number
  revoked_grant_ids: string[]
}

export async function POST(request: Request) {
  if (!CRON_SECRET) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'CRON_SECRET not configured — define em .env.local',
        },
      },
      { status: 500 },
    )
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${CRON_SECRET}`
  if (!timingSafeEqual(authHeader, expected)) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Token de cron inválido' },
      },
      { status: 401 },
    )
  }

  try {
    const result = await db.execute<{ process_grants_expired: GrantsExpiredResult }>(
      sql`SELECT process_grants_expired() AS process_grants_expired`,
    )
    const data = result.rows[0]?.process_grants_expired as GrantsExpiredResult | undefined
    if (!data) {
      throw new Error('process_grants_expired() returned empty')
    }

    console.log(
      JSON.stringify({
        level: 'info',
        job: 'process-grants-expired',
        ...data,
      }),
    )

    return NextResponse.json({ ok: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        level: 'error',
        job: 'process-grants-expired',
        error: message,
      }),
    )
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Falha ao processar grants expirados' },
      },
      { status: 500 },
    )
  }
}

/**
 * Comparação string time-safe (evita timing attacks em token check).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
