/**
 * POST /api/jobs/billing-daily — Sprint 04 Faixa D.
 *
 * Cron diário 03:30 UTC chamando SQL function `create_recurring_invoices()`.
 * Gera 1 invoice `pending` por contract `active` cujo `billing_day = day(now+5d)`,
 * D-5 do vencimento. Idempotente (filtra via NOT EXISTS).
 *
 * Auth via `CRON_SECRET` env (bearer + timingSafeEqual).
 * Mesmo padrão de `process-trial-lifecycle` + `process-grants-expired`.
 *
 * Sprint 04+ Faixa D: sync com Asaas API (criar cobrança real + setar
 * `invoices.asaas_id`) entra em outra job ou nesta mesma function após
 * SQL gerar local invoices.
 */
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@repo/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

interface BillingDailyResult {
  processed_at: string
  target_billing_day: number
  newly_created: number
  invoice_ids: string[]
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
        error: {
          code: 'INTERNAL_ERROR',
          message: 'CRON_SECRET not configured — define em .env.local',
        },
      },
      { status: 500 },
    )
  }
  const authHeader = request.headers.get('authorization') ?? ''
  if (!timingSafeEqual(authHeader, `Bearer ${CRON_SECRET}`)) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Token de cron inválido' },
      },
      { status: 401 },
    )
  }

  try {
    const result = await db.execute<{ create_recurring_invoices: BillingDailyResult }>(
      sql`SELECT create_recurring_invoices() AS create_recurring_invoices`,
    )
    const data = result.rows[0]?.create_recurring_invoices as
      | BillingDailyResult
      | undefined
    if (!data) {
      throw new Error('create_recurring_invoices() returned empty')
    }
    console.log(
      JSON.stringify({
        level: 'info',
        job: 'billing-daily',
        ...data,
      }),
    )
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        level: 'error',
        job: 'billing-daily',
        error: message,
      }),
    )
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Falha ao gerar invoices' },
      },
      { status: 500 },
    )
  }
}
