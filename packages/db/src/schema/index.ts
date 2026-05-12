/**
 * Single source of truth pro schema do banco (regra 3 + ADR 0004).
 *
 * `drizzle-kit generate` lê este re-export pra produzir migrations em
 * `packages/db/migrations/*.sql`.
 *
 * Convenção: cada agrupamento de tabelas em arquivo próprio
 * (`persons.ts`, `identity.ts`, `cnpj-cache.ts`, `better-auth.ts`,
 * `auth-attempts.ts`, ...), e este index reexporta tudo.
 *
 * **Por que auth schemas ficam em `@repo/db`** (não em `@repo/auth`):
 * `@repo/auth` consome `@repo/db` (precisa de adapter Drizzle + acesso
 * às tabelas). Inverter dependência criaria ciclo. Schemas são SQL state;
 * config + helpers de auth vivem em `@repo/auth`.
 */
export * from './persons'
export * from './cnpj-cache'
export * from './identity'

// Sprint 01a Faixa B — BetterAuth (ADR 0092) + LogiFit auth_attempts/auth_lockouts
export * from './better-auth'
export * from './auth-attempts'
