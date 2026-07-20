/**
 * Passport email verification tokens — Sprint 02b4 fechamento.
 *
 * Tokens de confirmação de email pro paciente. Auth table sem `tenant_id`
 * (paciente sem vínculo clínico ainda). Padrão `member_auth_tokens`
 * (Sprint 26 ADR 0088) e `passport_signup_otps` (Sprint 02b backbone).
 *
 * **Geração**: dispatched após `signupPatient` INSERT + opcionalmente
 * via `change_email` flow (Sprint 02b5).
 *
 * **Consumo**: paciente clica link em `/api/cadastro/verify-email?t=<token>`
 * → re-hash + lookup + valida email match (proteção contra change_email
 * race) + UPDATE `passport_global_identities.email_verified_at = now()`.
 *
 * **TTL 24h**: link aceita janela folgada (email pode ficar parado no
 * inbox até paciente abrir). Single-use via `used_at`.
 *
 * **Sem RLS** — policy 0059 só GRANT (acesso via `pool.query` pré-auth).
 */
import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { passportGlobalIdentities } from './passport-identity'

/** Kind do token — Sprint 02b5 adicionou 'change_email' além do 'signup' original */
export type PassportEmailVerificationKind = 'signup' | 'change_email'

export const passportEmailVerificationTokens = pgTable(
  'passport_email_verification_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    passportGlobalIdentityId: uuid('passport_global_identity_id')
      .notNull()
      .references(() => passportGlobalIdentities.id, { onDelete: 'cascade' }),

    /** Snapshot do email no momento da geração — protege race contra change_email */
    email: text('email').notNull(),

    /**
     * Kind: 'signup' (confirmação pós-cadastro) ou 'change_email' (troca de email).
     * Default 'signup' pra compat com Sprint 02b4 (que não passava o campo).
     */
    kind: text('kind').notNull().default('signup'),

    /**
     * Novo email target em kind='change_email'. NULL em kind='signup'.
     * Check constraint no DB enforça consistência.
     */
    newEmail: text('new_email'),

    /** SHA-256 do token plain (nunca grava plain) */
    tokenHash: text('token_hash').notNull(),

    /** TTL 24h após createdAt */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /** Single-use — marca quando paciente clica e verifica */
    usedAt: timestamp('used_at', { withTimezone: true }),

    /** IP do request original (audit) */
    requestIp: text('request_ip'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('passport_email_verification_token_hash_uq').on(t.tokenHash),
    /** Lookup quente: tokens de uma identity ordenados por created_at */
    index('passport_email_verification_identity_idx').on(
      t.passportGlobalIdentityId,
      t.createdAt.desc(),
    ),
    /** Active tokens (used_at IS NULL) — rate limit + cleanup cron */
    index('passport_email_verification_active_idx')
      .on(t.passportGlobalIdentityId, t.expiresAt)
      .where(sql`${t.usedAt} IS NULL`),
    /** Filtro por kind (cron cleanup pode separar comportamento) */
    index('passport_email_verification_kind_idx').on(t.kind, t.expiresAt),
  ],
)

export type PassportEmailVerificationTokenRow = typeof passportEmailVerificationTokens.$inferSelect
export type PassportEmailVerificationTokenInsert =
  typeof passportEmailVerificationTokens.$inferInsert
