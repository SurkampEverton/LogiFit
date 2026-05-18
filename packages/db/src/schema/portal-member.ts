/**
 * Portal do Paciente — Sprint 26 Faixa A.
 *
 * 2 tabelas mínimas (Sprint 26 reusa toda a infra existente):
 *   - member_auth_tokens — magic link (token_hash SHA-256, TTL 15min, single-use)
 *   - member_sessions    — sessão multi-dispositivo (refresh_token_hash SHA-256,
 *                          TTL 30d, last_seen_at pro UI mostrar dispositivos)
 *
 * **Token hash, não token plano** — guardamos SHA-256(token); o token plano
 * só circula no link enviado por email/SMS. Defesa contra leak de DB.
 *
 * **APPEND-ONLY pra audit (regra 5)?** — Não. Tokens precisam ser marcados
 * como `used_at` (single-use), e sessions precisam atualizar `last_seen_at`
 * + `revoked_at`. **Mas** todo evento crítico (request, verify, revoke) grava
 * em `audit_log` (Sprint 01a Faixa F) — esse SIM é append-only.
 *
 * **RLS member role** — Sprint 26 introduz role `member` no JWT. Tabelas de
 * domínio (members, appointments, invoices, workouts, consultas, evolucoes)
 * recebem policy adicional "próprios dados" via 0045_portal_member_rls.sql.
 *
 * **Anti-enumeration** — `requestMagicLink` sempre retorna ok (mesmo se email
 * não existe). Rate limit por email + IP (regra 36). Detalhe na lib pura.
 *
 * **ADR 0088 (esperado)** — auth member magic link 15min TTL + JWT role=member
 * + sessão 30d separada de operador.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { members } from './members'

// ─── member_auth_tokens ──────────────────────────────────────────────────
/**
 * Magic link tokens — single-use, TTL 15min.
 *
 * Fluxo:
 *   1. requestMagicLink(email) → gera token random 256-bit → SHA-256 → grava
 *      hash em member_auth_tokens (token plano vai no email)
 *   2. verifyMagicLink(token plano) → SHA-256(token) → lookup por token_hash
 *      → checa expires_at + used_at IS NULL → marca used_at = now() → cria
 *      member_session
 *
 * **Index sem RLS** — magic link verify acontece ANTES de auth (não há
 * tenant_id no contexto). Verify usa Drizzle direto bypass-RLS via
 * `app.bypass_rls=true` setting. RLS aplica DEPOIS de verify pra leitura
 * por member em outras tabelas.
 */
export const memberAuthTokens = pgTable(
  'member_auth_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** SHA-256 do token (token plano só circula no email/SMS) */
    tokenHash: text('token_hash').notNull(),
    /** Canal usado pra entregar o link */
    channel: text('channel').notNull().default('email'), // 'email' | 'sms'
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** IP que solicitou o magic link (audit + rate limit) */
    requestIp: text('request_ip'),
    /** User-Agent que solicitou */
    requestUserAgent: text('request_user_agent'),
    /** IP que consumiu (verify) */
    consumedIp: text('consumed_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mat_token_hash_uq').on(t.tokenHash),
    index('mat_member_idx').on(t.memberId, t.createdAt.desc()),
    index('mat_tenant_idx').on(t.tenantId, t.createdAt.desc()),
    /** Lookup quente: tokens ativos por member (rate limit checa últimos 15min) */
    index('mat_member_active_idx')
      .on(t.memberId, t.expiresAt)
      .where(sql`used_at IS NULL`),
  ],
)

// ─── member_sessions ──────────────────────────────────────────────────────
/**
 * Sessões multi-dispositivo. Refresh token rota a cada uso (single-use rotation
 * é stretch — Sprint 26 entrega refresh estático 30d, rotation Sprint 26b).
 *
 * `device_label` ajuda paciente identificar dispositivos no UI
 * (`/meu/perfil/dispositivos`). UA bruto guardado pra audit.
 *
 * `revoked_at` é UPDATE permitido (não append-only). Soft-revoke pra preservar
 * trilha de uso (last_seen_at + audit_log refletem).
 */
export const memberSessions = pgTable(
  'member_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** SHA-256 do refresh token */
    refreshTokenHash: text('refresh_token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Label legível ("iPhone de Maria", "Chrome Windows") — paciente pode editar */
    deviceLabel: text('device_label'),
    /** User-Agent bruto pra audit */
    userAgent: text('user_agent'),
    /** IP que criou a sessão */
    createdIp: text('created_ip'),
    /** Última atividade — atualizado a cada renovação de access token */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Último IP visto */
    lastSeenIp: text('last_seen_ip'),
    /** Soft-revoke: NULL = ativa */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ms_refresh_hash_uq').on(t.refreshTokenHash),
    index('ms_member_idx').on(t.memberId, t.lastSeenAt.desc()),
    index('ms_tenant_idx').on(t.tenantId, t.lastSeenAt.desc()),
    /** Lookup quente: sessões ativas */
    index('ms_member_active_idx')
      .on(t.memberId, t.expiresAt)
      .where(sql`revoked_at IS NULL`),
  ],
)

// ─── member_consents (intra-tenant) ───────────────────────────────────────
/**
 * Consent por finalidade dentro do tenant (regra 29 + ADR 0054).
 *
 * Diferente de `consents` (Sprint 01b — passaporte cross-tenant em
 * `patient_company_links`). Esta tabela é pro paciente granular dentro de UM
 * tenant ligar/desligar finalidades específicas:
 *   - marketing (envio whatsapp promocional)
 *   - cross_module_share (fisio vê dados da academia no mesmo tenant)
 *   - analytics_anon (dados anonimizados em métricas agregadas)
 *   - photo_use (uso de foto em material institucional)
 *
 * Revogação imediata (UPDATE permitido em `revoked_at`); audit grava cada
 * mudança via trigger (Sprint 26b: trigger explícito; MVP: handler grava em
 * `audit_log`).
 */
export const memberConsents = pgTable(
  'member_consents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** Chave canônica: 'marketing', 'cross_module_share', 'analytics_anon', 'photo_use' */
    purpose: text('purpose').notNull(),
    /** True = concedido; false = explicitamente negado; ausente = nunca solicitado */
    granted: boolean('granted').notNull(),
    /** Versão da RIPD vigente no momento do consent (regra 29) */
    ripdVersion: text('ripd_version'),
    /** Texto exato apresentado ao paciente */
    consentText: text('consent_text'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft-revoke: paciente desligou */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** IP de quem confirmou (audit LGPD) */
    sourceIp: text('source_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** 1 consent ativo por (member, purpose) — novo grant substitui */
    uniqueIndex('mc_member_purpose_active_uq')
      .on(t.memberId, t.purpose)
      .where(sql`revoked_at IS NULL`),
    index('mc_tenant_idx').on(t.tenantId, t.updatedAt.desc()),
    index('mc_member_idx').on(t.memberId, t.updatedAt.desc()),
  ],
)
