import { test } from '@playwright/test'

/**
 * critical/cross-tenant-rls — prova isolamento RLS comportamental (T6 ADR 0090).
 * Bloqueia deploy prod se falhar (ADR 0090 §5 — Top-12 block release).
 *
 * **Sprint 01a Faixa H — Vitest cobre o caso ESSENCIAL:**
 * `packages/db/tests/rls-runtime.test.ts` (8 tests) prova isolamento
 * persons/companies/units via 2 conexões `logifit_app` em paralelo +
 * INSERT cross-tenant rejeitado pela WITH CHECK + system roles
 * cross-tenant visíveis.
 *
 * Este E2E Playwright fica `test.skip` até Sprint 02+ ter:
 *   - BetterAuth provisionado em ambiente E2E (test users + magic link mock)
 *   - Seed de members reais (Sprint 02 — CRM)
 *   - helpers/auth.ts loginAs(persona, scenario) implementado
 *
 * Cenário E2E completo (futuro):
 *   1. Login persona 'recepcao' do tenant Rede Equilíbrio
 *   2. GET /app/pessoas → vê só persons da Rede (4 rows)
 *   3. GET /api/persons/{id-da-Franquia} → 404 (RLS bloqueia)
 *   4. Logout → login 'recepcao' da Franquia → vê só persons da Franquia (3)
 *
 * Cobertura SQL-level está garantida via Vitest desde Sprint 01a Faixa H —
 * suficiente pra gate "deploy prod" enquanto E2E real não plugado.
 */
test.skip('tenant B não vê dado de tenant A via SELECT direto no DB (E2E completo Sprint 02+)', async () => {
  // Coberto em SQL-level via Vitest: packages/db/tests/rls-runtime.test.ts
})
