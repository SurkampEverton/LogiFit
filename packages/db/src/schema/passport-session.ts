/**
 * Passport global sessions — Sprint 02b3 (ADR 0094).
 *
 * Sessões dedicadas pra paciente com identidade global (`passport_global_identities`).
 * Análogo a `member_sessions` (Sprint 26 ADR 0088) mas SEM `tenant_id`/`member_id` —
 * paciente pode ter session sem estar linkado a nenhum tenant clínico ainda.
 *
 * **Cookie**: `lf_passport_session` (distinto de `lf_member_session`); mesmo
 * path `/meu`; httpOnly + Secure + SameSite=Lax + 30d.
 *
 * **Acesso**:
 *   - `getPassportSession()` → lookup por SHA-256 do refresh token plain
 *     (cookie armazena plain; tabela armazena hash; padrão ADR 0088)
 *   - Server Action interna roda como `logifit_app` SEM RLS (policy 0058
 *     só GRANT). Lookup atomic + idempotente.
 *
 * **Migration path** (ADR 0094 §"Migration path"):
 *   - Fase 1 (Sprint 02b3 — ativo): novos signups proativos passport;
 *     magic link Sprint 26 continua member_sessions
 *   - Fase 2 (Sprint 02b4): magic link promove paciente sem identity
 *   - Fase 3 (pós-MVP): backfill + deprecate member_sessions INSERT
 *
 * **MFA gate**: `mfa_verified_at` setado quando paciente completa TOTP
 * em login fresh. `requirePassportMfa()` checa recency <15min pra ações
 * de alto risco do paciente (trocar email/senha/recovery codes).
 */
import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { passportGlobalIdentities } from './passport-identity'

export const passportGlobalSessions = pgTable(
  'passport_global_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    passportGlobalIdentityId: uuid('passport_global_identity_id')
      .notNull()
      .references(() => passportGlobalIdentities.id, { onDelete: 'cascade' }),

    /** SHA-256 do refresh token plain (nunca grava plain) */
    refreshTokenHash: text('refresh_token_hash').notNull(),

    /** TTL — default 30d após createdAt */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /** User-Agent simplificado (cliente passa header User-Agent) */
    deviceLabel: text('device_label'),
    /** IP do request (audit + suspicion detection futura) */
    ip: text('ip'),

    /** MFA TOTP — setado quando paciente completa TOTP em login fresh.
     * requirePassportMfa() checa recency <15min pra ações de alto risco. */
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),

    /** Lifecycle */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'), // 'user_logout' | 'admin_revoke' | 'password_change' | 'mfa_change' | 'session_rotation'
  },
  (t) => [
    /** UNIQUE hash — previne colisão (extremamente improvável mas defesa) */
    uniqueIndex('passport_global_sessions_token_uq').on(t.refreshTokenHash),
    /** Lookup quente: sessions de uma identity ordenadas por created_at */
    index('passport_global_sessions_identity_idx').on(
      t.passportGlobalIdentityId,
      t.createdAt.desc(),
    ),
    /** Active sessions (revoked_at IS NULL) hot path */
    index('passport_global_sessions_active_idx')
      .on(t.passportGlobalIdentityId, t.expiresAt.desc())
      .where(sql`${t.revokedAt} IS NULL`),
    /** Cleanup cron: encontra expiradas */
    index('passport_global_sessions_cleanup_idx')
      .on(t.expiresAt)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
)

export type PassportGlobalSessionRow = typeof passportGlobalSessions.$inferSelect
export type PassportGlobalSessionInsert = typeof passportGlobalSessions.$inferInsert
