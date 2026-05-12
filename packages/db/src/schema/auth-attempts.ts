/**
 * `auth_attempts` + `auth_lockouts` — LogiFit-owned (não BetterAuth).
 *
 * Implementa regra de lockout do ADR 0073 camada 2:
 *   - 5 falhas em 15 min (por email OU ip) → lockout 30 min
 *   - Captcha Turnstile ativa após 3 falhas no IP
 *   - Alerta email pro titular após 5 falhas ("tentaram logar na sua conta")
 *
 * **Particionada por mês** (regra 34 + ADR 0072) — auth_attempts pode crescer
 * pra milhões de rows/mês em produção. Particionamento + retenção 30d (regra 5).
 *
 * **RLS:** essas tabelas são GLOBAIS (sem tenant_id) — login acontece ANTES
 * de tenant ser conhecido. RLS é por `email IS NULL OR email = current_user_email`
 * mas no Sprint 01a fica DENY total via FORCE — só Server Actions servidor-side
 * (via role `logifit_admin` com BYPASSRLS quando necessário) escreve/lê.
 *
 * Sprint 01a Faixa B cria as tabelas; partições mensais + retention job vêm
 * na Faixa F (audit + particionamento).
 */
import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// ─── auth_attempts ────────────────────────────────────────────────────────
// SEM particionamento ainda — Faixa F adiciona com regra 34 (volume > 5M/ano)
export const authAttempts = pgTable(
  'auth_attempts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: text('email'), // nullable porque pode haver tentativa sem email (ex.: token expirado)
    ip: text('ip').notNull(),
    userAgent: text('user_agent'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    success: boolean('success').notNull(),
    // 'wrong_password' | 'mfa_failed' | 'user_disabled' | 'rate_limited' |
    // 'captcha_failed' | 'magic_link_expired' | 'magic_link_invalid' | 'unknown'
    failureReason: text('failure_reason'),
  },
  (t) => [
    index('auth_attempts_email_attempted_idx').on(t.email, t.attemptedAt.desc()),
    index('auth_attempts_ip_attempted_idx').on(t.ip, t.attemptedAt.desc()),
  ],
)

// ─── auth_lockouts ────────────────────────────────────────────────────────
// Estado ativo de lockout (5 falhas/15min → 30min cooldown).
// 1 row por (email, ip) ativa por vez; cleanup via job quando `locked_until < now()`.
export const authLockouts = pgTable(
  'auth_lockouts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: text('email'),
    ip: text('ip').notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }).notNull(),
    reason: text('reason').notNull().default('too_many_failures'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_lockouts_email_idx').on(t.email),
    index('auth_lockouts_ip_idx').on(t.ip),
    index('auth_lockouts_locked_until_idx').on(t.lockedUntil),
  ],
)

export type AuthAttemptRow = typeof authAttempts.$inferSelect
export type AuthAttemptInsert = typeof authAttempts.$inferInsert
export type AuthLockoutRow = typeof authLockouts.$inferSelect
export type AuthLockoutInsert = typeof authLockouts.$inferInsert
