/**
 * POST /api/jobs/expire-passport-global-sessions — Sprint 02b3 (ADR 0094).
 *
 * Cron daily (idealmente 03:35 UTC = 00:35 SP — após expire-passport-signup-otps
 * pra evitar contention no mesmo banco) — cleanup de sessions inativas:
 *   1. UPDATE passport_global_sessions SET revoked_at = expires_at, revoked_reason = 'expired'
 *      WHERE revoked_at IS NULL AND expires_at < now (marca expiradas como revogadas
 *      preservando histórico — não DELETE)
 *   2. DELETE sessions revoked há mais de 30 dias (audit retention)
 *
 * Audit preservation rationale: paciente pode questionar "foi logado em IP estranho
 * há 25 dias?" — precisamos manter sessions revogadas 30d. Compliance LGPD art. 18 V.
 *
 * Auth: shared secret via header `Authorization: Bearer $CRON_SECRET` (mesmo
 * padrão expire-passport-signup-otps Sprint 02b backbone).
 */
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@repo/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

interface CleanupResult {
  processed_at: string
  expired_revoked: number
  revoked_audit_deleted: number
  remaining_active: number
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export async function POST(request: Request) {
  if (!CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'CRON_SECRET not configured' } },
      { status: 500 },
    )
  }
  const authHeader = request.headers.get('authorization') ?? ''
  if (!timingSafeEqual(authHeader, `Bearer ${CRON_SECRET}`)) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Token de cron inválido' } },
      { status: 401 },
    )
  }

  try {
    // 1. Marca expiradas como revoked (preserva audit, não DELETE)
    const expiredResult = await db.execute<{ count: number }>(sql`
      WITH upd AS (
        UPDATE passport_global_sessions
        SET revoked_at = expires_at, revoked_reason = 'expired'
        WHERE revoked_at IS NULL
          AND expires_at < now()
        RETURNING id
      )
      SELECT count(*)::int AS count FROM upd
    `)
    const expiredRevoked = expiredResult.rows[0]?.count ?? 0

    // 2. Hard delete sessions revoked há mais de 30 dias
    const auditResult = await db.execute<{ count: number }>(sql`
      WITH del AS (
        DELETE FROM passport_global_sessions
        WHERE revoked_at IS NOT NULL
          AND revoked_at < (now() - INTERVAL '30 days')
        RETURNING id
      )
      SELECT count(*)::int AS count FROM del
    `)
    const revokedAuditDeleted = auditResult.rows[0]?.count ?? 0

    // 3. Conta active remanescentes (sanity check)
    const remainingResult = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM passport_global_sessions
      WHERE revoked_at IS NULL AND expires_at > now()
    `)
    const remainingActive = remainingResult.rows[0]?.count ?? 0

    const data: CleanupResult = {
      processed_at: new Date().toISOString(),
      expired_revoked: expiredRevoked,
      revoked_audit_deleted: revokedAuditDeleted,
      remaining_active: remainingActive,
    }

    console.log(
      JSON.stringify({ level: 'info', job: 'expire-passport-global-sessions', ...data }),
    )
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        level: 'error',
        job: 'expire-passport-global-sessions',
        error: message,
      }),
    )
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Falha ao expirar sessions passport' },
      },
      { status: 500 },
    )
  }
}
