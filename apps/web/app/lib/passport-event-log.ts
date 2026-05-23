/**
 * Passport event log helper — Sprint 02c.4.
 *
 * Emite eventos em `patient_link_events` (tabela particionada mensal, ADR
 * 0077 + regra 34) pra trilha audit operacional do lifecycle de vínculos
 * cross-tenant. Substitui timeline derivada de timestamps em
 * `/app/passport/invites/[id]` por evento append-only.
 *
 * **Append-only** (regra 5): RLS bloqueia UPDATE/DELETE. Caller precisa só
 * passar o evento + metadados — helper resolve tenant_id automaticamente
 * a partir do link (ou aceita override pro caso edge de evento system-level
 * sem link).
 *
 * **Best-effort**: falha de INSERT NÃO bloqueia o SA principal. Loga warning
 * estruturado via pino (regra 33) — perda do evento de audit é menos pior
 * que rollback de operação que o usuário viu sucesso. Re-tentativa via
 * outbox fica pra Sprint 02d+ (quando virar problema mensurável).
 */
import { db } from '@repo/db/client'
import { type PatientLinkEventInsert, patientLinkEvents } from '@repo/db/schema'
import type { PgTransaction } from 'drizzle-orm/pg-core'

export type PassportEventActor = 'professional' | 'patient' | 'system'

export type PassportEventKind =
  | 'invite_sent'
  | 'invite_resent'
  | 'invite_cancelled'
  | 'link_accepted'
  | 'link_revoked'
  | 'module_added'
  | 'module_activated'
  | 'module_deactivated'
  | 'module_substituted'
  | 'data_levels_changed'

export interface LogPatientLinkEventInput {
  tenantId: string
  linkId: string | null
  passportPassportId: string
  patientPersonId: string
  actorKind: PassportEventActor
  actorUserId?: string | null
  eventKind: PassportEventKind
  payload?: Record<string, unknown> | null
  requestId?: string | null
}

/**
 * Insere 1 row em `patient_link_events`. Idempotência NÃO é garantida —
 * caller que precisar deduplicar passa um requestId estável e checa antes.
 *
 * @param input - dados do evento (todos obrigatórios exceto actorUserId/payload/requestId)
 * @param tx - opcional: drizzle transaction; usa db top-level se omitido
 */
export async function logPatientLinkEvent(
  input: LogPatientLinkEventInput,
  // biome-ignore lint/suspicious/noExplicitAny: tx type em drizzle requer schema completo; isolated suffices
  tx?: PgTransaction<any, any, any>,
): Promise<void> {
  const insert: PatientLinkEventInsert = {
    tenantId: input.tenantId,
    linkId: input.linkId,
    passportPassportId: input.passportPassportId,
    patientPersonId: input.patientPersonId,
    actorKind: input.actorKind,
    actorUserId: input.actorUserId ?? null,
    eventKind: input.eventKind,
    payload: (input.payload as PatientLinkEventInsert['payload']) ?? null,
    requestId: input.requestId ?? null,
  }
  const conn = tx ?? db
  try {
    await conn.insert(patientLinkEvents).values(insert)
  } catch (err) {
    // Best-effort: log estruturado, não relança. Outbox + retry Sprint 02d+.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'patient_link_event_insert_failed',
        eventKind: input.eventKind,
        linkIdPrefix: input.linkId?.slice(0, 8) ?? null,
        tenantIdPrefix: input.tenantId.slice(0, 8),
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
  }
}
