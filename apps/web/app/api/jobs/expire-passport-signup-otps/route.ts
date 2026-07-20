import { db } from '@repo/db/client'
/**
 * POST /api/jobs/expire-passport-signup-otps — Sprint 02b backbone fechamento.
 *
 * Cron diário (idealmente 03:30 UTC = 00:30 SP) — cleanup OTPs SMS pré-auth:
 *   1. Hard delete OTPs expirados não-usados (expires_at < now - 24h)
 *   2. Hard delete OTPs usados há mais de 30 dias (used_at < now - 30d)
 *
 * Preserva used_at recente (≤30d) pra audit forense de signup (LGPD art. 18 V —
 * portabilidade) e detecção de tentativas de replay.
 *
 * Idempotente — múltiplas execuções no mesmo dia retornam contagem zero
 * adicional após a primeira.
 *
 * Auth: shared secret via header `Authorization: Bearer $CRON_SECRET`
 * (mesmo padrão de billing-daily / expire-credits / trial-lifecycle).
 *
 * Schema-aware: tabela `passport_signup_otps` é sem RLS (pré-auth global —
 * ver `packages/db/src/policies/0056_passport_signup_otps.sql`).
 */
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

interface CleanupResult {
  processed_at: string
  expired_deleted: number
  used_audit_deleted: number
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
    // 1. Hard delete OTPs expirados não-usados (>24h)
    //    Janela 24h pós-expires_at — antes disso, mantém pra debug de "código não chegou"
    const expiredResult = await db.execute<{ count: number }>(sql`
      WITH del AS (
        DELETE FROM passport_signup_otps
        WHERE used_at IS NULL
          AND expires_at < (now() - INTERVAL '24 hours')
        RETURNING id
      )
      SELECT count(*)::int AS count FROM del
    `)
    const expiredDeleted = expiredResult.rows[0]?.count ?? 0

    // 2. Hard delete OTPs usados há mais de 30 dias (audit retention)
    const usedResult = await db.execute<{ count: number }>(sql`
      WITH del AS (
        DELETE FROM passport_signup_otps
        WHERE used_at IS NOT NULL
          AND used_at < (now() - INTERVAL '30 days')
        RETURNING id
      )
      SELECT count(*)::int AS count FROM del
    `)
    const usedAuditDeleted = usedResult.rows[0]?.count ?? 0

    // 3. Conta remanescentes ativos (sanity check)
    const remainingResult = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM passport_signup_otps
      WHERE used_at IS NULL AND expires_at > now()
    `)
    const remainingActive = remainingResult.rows[0]?.count ?? 0

    const data: CleanupResult = {
      processed_at: new Date().toISOString(),
      expired_deleted: expiredDeleted,
      used_audit_deleted: usedAuditDeleted,
      remaining_active: remainingActive,
    }

    console.log(JSON.stringify({ level: 'info', job: 'expire-passport-signup-otps', ...data }))
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        level: 'error',
        job: 'expire-passport-signup-otps',
        error: message,
      }),
    )
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Falha ao expirar OTPs de cadastro' },
      },
      { status: 500 },
    )
  }
}
