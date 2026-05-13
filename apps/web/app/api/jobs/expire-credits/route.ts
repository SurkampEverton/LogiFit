/**
 * POST /api/jobs/expire-credits — Sprint 05 Faixa D.
 *
 * Cron 03:45 UTC. SQL function `process_expired_credits()` marca
 * appointment_credits expirados com balance=0. Idempotente.
 *
 * Auth via CRON_SECRET (mesmo padrão de billing-daily / trial-lifecycle /
 * grants-expired).
 */
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@repo/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

interface ExpireResult {
  processed_at: string
  newly_expired: number
  credit_ids: string[]
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
    const result = await db.execute<{ process_expired_credits: ExpireResult }>(
      sql`SELECT process_expired_credits() AS process_expired_credits`,
    )
    const data = result.rows[0]?.process_expired_credits as ExpireResult | undefined
    if (!data) throw new Error('process_expired_credits() returned empty')
    console.log(JSON.stringify({ level: 'info', job: 'expire-credits', ...data }))
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(JSON.stringify({ level: 'error', job: 'expire-credits', error: message }))
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Falha ao expirar créditos' } },
      { status: 500 },
    )
  }
}
