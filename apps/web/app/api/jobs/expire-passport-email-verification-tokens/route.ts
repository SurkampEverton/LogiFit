import { db } from '@repo/db/client'
/**
 * POST /api/jobs/expire-passport-email-verification-tokens — Sprint 02b5.
 *
 * Cron daily ~03:55 UTC = 00:55 SP (depois de hard-delete-deactivated-passport
 * pra reduzir contention nas FK CASCADE).
 *
 * Limpa `passport_email_verification_tokens` em 2 critérios:
 *
 * 1. **Tokens usados há >30 dias** — `used_at < now() - 30 days`.
 *    Audit retention LGPD art. 18 V (acesso a histórico de operações)
 *    cobre janela suficiente; após 30d, valor de audit é mínimo + privacy
 *    by design recomenda deleção.
 *
 * 2. **Tokens não-usados expirados há >7 dias** — `used_at IS NULL AND
 *    expires_at < now() - 7 days`. TTL original é 24h (signup) / 24h
 *    (change_email); janela extra de 7d preserva audit de tokens que
 *    expiraram (paciente pediu link mas nunca clicou — pode indicar
 *    bug/spam) antes de deletar.
 *
 * Cobre **ambos kinds**: 'signup' (Sprint 02b4) e 'change_email' (Sprint 02b5).
 *
 * Auth: shared secret via `Authorization: Bearer $CRON_SECRET`. Mesmo padrão
 * de `hard-delete-deactivated-passport` + `expire-passport-global-sessions`.
 */
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

/** Audit retention pra tokens usados (LGPD art. 18 V). */
const USED_RETENTION_DAYS = 30

/** Janela pós-expiração pra tokens não-usados (audit de tokens nunca clicados). */
const UNUSED_EXPIRED_GRACE_DAYS = 7

interface CleanupResult {
  processed_at: string
  used_deleted: number
  expired_unused_deleted: number
  remaining_total: number
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
      {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'CRON_SECRET not configured' },
      },
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
    // 1. DELETE tokens usados há >30d (ambos kinds)
    const usedResult = await db.execute<{ count: number }>(sql`
      WITH del AS (
        DELETE FROM passport_email_verification_tokens
        WHERE used_at IS NOT NULL
          AND used_at < (now() - (${USED_RETENTION_DAYS}::int * INTERVAL '1 day'))
        RETURNING id
      )
      SELECT count(*)::int AS count FROM del
    `)
    const usedDeleted = usedResult.rows[0]?.count ?? 0

    // 2. DELETE tokens não-usados expirados há >7d (ambos kinds)
    const expiredResult = await db.execute<{ count: number }>(sql`
      WITH del AS (
        DELETE FROM passport_email_verification_tokens
        WHERE used_at IS NULL
          AND expires_at < (now() - (${UNUSED_EXPIRED_GRACE_DAYS}::int * INTERVAL '1 day'))
        RETURNING id
      )
      SELECT count(*)::int AS count FROM del
    `)
    const expiredUnusedDeleted = expiredResult.rows[0]?.count ?? 0

    // 3. Sanity: total restante (pra dashboard / alerta se crescer demais)
    const remainingResult = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM passport_email_verification_tokens
    `)
    const remainingTotal = remainingResult.rows[0]?.count ?? 0

    const data: CleanupResult = {
      processed_at: new Date().toISOString(),
      used_deleted: usedDeleted,
      expired_unused_deleted: expiredUnusedDeleted,
      remaining_total: remainingTotal,
    }

    console.log(
      JSON.stringify({
        level: 'info',
        job: 'expire-passport-email-verification-tokens',
        ...data,
      }),
    )
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        level: 'error',
        job: 'expire-passport-email-verification-tokens',
        error: message,
      }),
    )
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Falha ao limpar tokens de email verification',
        },
      },
      { status: 500 },
    )
  }
}
