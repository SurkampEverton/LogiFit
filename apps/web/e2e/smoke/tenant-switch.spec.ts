import { test } from '@playwright/test'

/**
 * smoke/tenant-switch — troca de tenant via subdomain (ADR 0065).
 * Bloqueia merge se falhar (ADR 0090 §6 — Top-10 smoke).
 *
 * Cenário:
 *   1. login como user com acesso a 2 tenants (academia-a, academia-b)
 *   2. ir pra https://academia-a.logifit.com.br/app/dashboard → vê dado de A
 *   3. trocar pra academia-b via menu → URL muda + dashboard mostra dado de B
 *   4. cookie de sessão NÃO vaza dado de A pra B (regra 1)
 *
 * Implementação real depende de Sprint 01a (multi-tenant routing) + ADR 0065.
 */
test.skip('user com acesso multi-tenant troca via subdomain sem vazar dado', async () => {
  // const ctx = await loginAs(context, 'tenant_owner', 'rede-propria')
  // await page.goto('https://academia-a.logifit.com.br/app/dashboard')
  // ...
})
