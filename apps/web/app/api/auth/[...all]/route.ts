/**
 * BetterAuth handler route — Next.js 15 App Router.
 *
 * Captura todas as rotas `/api/auth/*` e delega pro BetterAuth.
 * Endpoints expostos automaticamente:
 *   POST /api/auth/sign-in/magic-link    — solicita magic link
 *   GET  /api/auth/verify?token=...      — completa magic link
 *   POST /api/auth/sign-out              — encerra sessão
 *   GET  /api/auth/get-session           — retorna sessão atual (JSON)
 *   POST /api/auth/two-factor/enable     — habilita TOTP
 *   POST /api/auth/two-factor/verify     — verifica TOTP código
 *   (+ outras do plugin)
 *
 * Não há código adicional aqui — toda lógica vive em `@repo/auth/server`.
 */
import { nextJsHandler } from '@repo/auth/server'

export const { GET, POST } = nextJsHandler()
