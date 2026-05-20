/**
 * POST /api/jobs/hard-delete-deactivated-passport — Sprint 02b4 (ADR 0094).
 *
 * Cron daily (idealmente 03:50 UTC = 00:50 SP — depois de
 * expire-passport-global-sessions pra reduzir contention).
 *
 * Hard delete passport_global_identities marcadas como `deactivated_at` há mais
 * de 30 dias (regra LGPD art. 18 VI — direito de exclusão / revogação consentimento).
 *
 * Janela 30d preserva direito de reativação manual via suporte
 * (privacidade@logifit.com.br) — Server Action `deactivateAccount` em
 * `apps/web/app/meu/perfil/passport-actions.ts` documenta esse contrato.
 *
 * **Cascade behavior** (FK CASCADE em `passport_global_sessions.passport_global_identity_id`):
 *   - DELETE da identity cascateia → DELETE de todas sessions
 *
 * **Persons bridge** (`persons.passport_global_identity_id` FK SET NULL no Sprint
 * 02b2): rows de persons em outros tenants ficam com FK NULL — paciente "virou"
 * member soft-deleted naquele tenant, mas dado clínico tenant-scoped persiste
 * pelos 20a Lei 13.787. Tenant pode reanonimizar via Sprint 26 portal flow.
 *
 * **Audit**: deleção é hard, mas linha equivalente em `data_subject_requests`
 * (Sprint 01b LGPD compliance) preserva trilha por 5a (id da identity + reason).
 * MVP só loga `count` deleted — sub-task futura grava DSR row.
 *
 * Auth: shared secret via header `Authorization: Bearer $CRON_SECRET` (mesmo
 * padrão expire-passport-global-sessions).
 */
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@repo/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_SECRET = process.env.CRON_SECRET

/** Janela LGPD art. 18 — paciente tem 30 dias pra reativar antes do hard delete. */
const HARD_DELETE_GRACE_DAYS = 30

interface DeleteResult {
  processed_at: string
  identities_deleted: number
  sessions_cascade_deleted: number
  remaining_deactivated_within_grace: number
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
    // 1. Conta sessions ativas das identities prestes a ser deletadas (audit pre-delete)
    const sessionCountResult = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM passport_global_sessions s
      JOIN passport_global_identities i ON i.id = s.passport_global_identity_id
      WHERE i.deactivated_at IS NOT NULL
        AND i.deactivated_at < (now() - (${HARD_DELETE_GRACE_DAYS}::int * INTERVAL '1 day'))
    `)
    const sessionsCascadeDeleted = sessionCountResult.rows[0]?.count ?? 0

    // 2. Hard delete identities → cascade limpa sessions via FK
    const deleteResult = await db.execute<{ count: number }>(sql`
      WITH del AS (
        DELETE FROM passport_global_identities
        WHERE deactivated_at IS NOT NULL
          AND deactivated_at < (now() - (${HARD_DELETE_GRACE_DAYS}::int * INTERVAL '1 day'))
        RETURNING id
      )
      SELECT count(*)::int AS count FROM del
    `)
    const identitiesDeleted = deleteResult.rows[0]?.count ?? 0

    // 3. Conta deactivated ainda dentro do grace period (sanity)
    const remainingResult = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM passport_global_identities
      WHERE deactivated_at IS NOT NULL
        AND deactivated_at >= (now() - (${HARD_DELETE_GRACE_DAYS}::int * INTERVAL '1 day'))
    `)
    const remainingDeactivatedWithinGrace = remainingResult.rows[0]?.count ?? 0

    const data: DeleteResult = {
      processed_at: new Date().toISOString(),
      identities_deleted: identitiesDeleted,
      sessions_cascade_deleted: sessionsCascadeDeleted,
      remaining_deactivated_within_grace: remainingDeactivatedWithinGrace,
    }

    console.log(
      JSON.stringify({
        level: 'info',
        job: 'hard-delete-deactivated-passport',
        ...data,
      }),
    )
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        level: 'error',
        job: 'hard-delete-deactivated-passport',
        error: message,
      }),
    )
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Falha ao deletar identities deactivated',
        },
      },
      { status: 500 },
    )
  }
}
