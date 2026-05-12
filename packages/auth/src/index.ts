/**
 * `@repo/auth` — BetterAuth wrapper LogiFit (ADR 0092).
 *
 * Entry points:
 *   - `@repo/auth/server` — instância `auth` server-side (Server Actions, API Routes, middleware)
 *   - `@repo/auth/client` — instância `authClient` Client Components ('use client')
 *
 * Re-exports aqui são intencionalmente vazios — força import explícito do
 * subpath correto pra evitar shipar código server-only pro bundle do cliente.
 */
export {}
