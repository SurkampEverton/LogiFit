import { expect, test } from '@playwright/test'

/**
 * smoke/auth-magic-link — fluxo de login via magic link (Sprint 01a).
 * Bloqueia merge se falhar (ADR 0090 §6 — Top-10 smoke).
 *
 * Cenário:
 *   1. POST /api/auth/magic-link com email válido
 *   2. Mailhog captura email com link
 *   3. Click no link redireciona pra /app/dashboard
 *   4. cookie httpOnly de sessão presente
 */
test.skip('login com magic link recebe email e redireciona pra /app', async ({ page }) => {
  await page.goto('/login')
  // a implementar Sprint 01a quando BetterAuth/Lucia estiver no lugar
})
