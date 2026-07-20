import { db } from '@repo/db/client'
/**
 * POST /api/jobs/process-trial-lifecycle — cron handler (ADR 0066).
 *
 * Roda diariamente (03:00 UTC) chamando SQL function `process_trial_lifecycle()`
 * que aplica transições de estado dos tenants:
 *   - D+14 trial expira  → subscription_status='trial_expired'
 *   - D+44 (30d expirado) → anonymize_trial_data() (NULLifica PII, preserva
 *                            agregados, audit_log com legal_basis)
 *
 * **Auth via `CRON_SECRET` env** (Authorization: Bearer <token>) — gate
 * mínimo MVP. Sprint 03+ cron daemon (node-cron/ofelia no container Coolify)
 * cria um header HMAC com timestamp pra anti-replay.
 *
 * **Resposta** (envelope ADR 0071):
 *   200 { ok: true, data: { processed_at, newly_expired, newly_anonymized, anonymized_tenant_ids[] } }
 *   401 { ok: false, error: { code: 'UNAUTHORIZED', ... } }    — token inválido
 *   500 { ok: false, error: { code: 'INTERNAL_ERROR', ... } }  — SQL falhou
 *
 * Idempotente — pode rodar várias vezes/dia sem efeito duplicado (SQL
 * function filtra por status atual antes de mudar).
 *
 * Sprint 02+: adicionar GlitchTip capture + system_alerts critical se
 * `newly_anonymized > 0` (compliance notification).
 */
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

interface TrialLifecycleResult {
  processed_at: string
  newly_expired: number
  newly_anonymized: number
  anonymized_tenant_ids: string[]
}

export async function POST(request: Request) {
  // Gate: Bearer token canônico LogiFit
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
    const result = await db.execute<{ process_trial_lifecycle: TrialLifecycleResult }>(
      sql`SELECT process_trial_lifecycle() AS process_trial_lifecycle`,
    )
    const data = result.rows[0]?.process_trial_lifecycle as TrialLifecycleResult | undefined
    if (!data) {
      throw new Error('process_trial_lifecycle() returned empty')
    }

    // Log estruturado pra Loki/Grafana captarem (pino → stdout → Promtail)
    console.log(
      JSON.stringify({
        level: 'info',
        job: 'process-trial-lifecycle',
        ...data,
      }),
    )

    return NextResponse.json({ ok: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        level: 'error',
        job: 'process-trial-lifecycle',
        error: message,
      }),
    )
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Falha ao processar trial lifecycle' },
      },
      { status: 500 },
    )
  }
}

/**
 * Comparação string time-safe (evita timing attacks em token check).
 * Node.js timingSafeEqual exige Buffers de mesmo length — wrapper aqui
 * faz validação de comprimento antes (defesa: leak de length é OK pra cron
 * token de tamanho fixo).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
