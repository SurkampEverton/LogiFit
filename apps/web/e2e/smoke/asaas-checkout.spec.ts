import { test } from '@playwright/test'

/**
 * smoke/asaas-checkout — checkout Asaas sandbox.
 * Bloqueia merge se falhar (ADR 0090 §6).
 *
 * Cenário (Sprint 04 — financeiro Asaas):
 *   1. login member
 *   2. /app/billing/checkout — escolhe plano Starter mensal
 *   3. submit → MSW intercepta POST /asaas/v3/payments (T8 sandbox handler)
 *   4. UI redireciona pra /app/billing/success com Toast
 *   5. webhook Asaas é replayed via helpers/webhooks.ts → invoice = 'paid'
 *
 * Testa happy path; idempotência (T7) é cenário critical/asaas-idempotencia.
 */
test.skip('member faz checkout Asaas sandbox e invoice fica paid via webhook', async () => {
  // implementação Sprint 04 (após MSW handler Asaas em e2e/_mocks/)
})
