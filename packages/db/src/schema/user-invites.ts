/**
 * Convites de staff — Sprint 01c (ADR 0103; débito #6 da auditoria 36b).
 *
 * MVP: só role `contador_externo` (CHECK) — expandir pra outros roles exige
 * revisar MFA obrigatório da role convidada (regra 43) + UI.
 *
 * Token NUNCA em claro: `token_hash` sha256; o token de 32 bytes só existe
 * na URL enviada por email (TTL 7 dias). Aceite não cria sessão — usuário
 * entra via magic link normal depois do provisioning.
 *
 * @volume_estimate_yearly: 5000
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './identity'

export const userInvites = pgTable(
  'user_invites',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    email: text('email').notNull(),
    /** Nome sugerido pelo admin (aceite pode corrigir) */
    name: text('name'),
    /** Role global a atribuir no aceite — MVP restrito a contador_externo */
    roleKey: text('role_key').notNull().default('contador_externo'),
    /** sha256 hex do token — token em claro só na URL do email */
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    /** User criado no aceite (rastreio) */
    acceptedUserId: uuid('accepted_user_id').references(() => users.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_invites_token_hash_uq').on(t.tokenHash),
    // 1 convite pendente por (tenant, email) — aceito/revogado libera novo
    uniqueIndex('user_invites_pending_uq')
      .on(t.tenantId, t.email)
      .where(sql`accepted_at IS NULL AND revoked_at IS NULL`),
    index('user_invites_tenant_idx').on(t.tenantId),
    check('user_invites_role_mvp', sql`role_key IN ('contador_externo')`),
    check(
      'user_invites_state_exclusive',
      sql`NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)`,
    ),
    check(
      'user_invites_accepted_consistency',
      sql`(accepted_at IS NULL) = (accepted_user_id IS NULL)`,
    ),
  ],
)
