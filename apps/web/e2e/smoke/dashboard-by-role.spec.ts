import { test } from '@playwright/test'

/**
 * smoke/dashboard-by-role — dashboard "Equilíbrio Vital" renderiza widgets
 * filtrados por role (ADR 0063 + Sprint 07).
 * Bloqueia merge se falhar (ADR 0090 §6).
 *
 * Cenário:
 *   1. fisio loga → vê widgets clínicos (atendimentos do dia, evoluções
 *      pendentes); NÃO vê DRE consolidado nem cobrança
 *   2. tenant_owner loga → vê widgets financeiros (DRE, cashflow); NÃO vê
 *      dados clínicos brutos de pacientes (LGPD)
 *   3. member loga → vê só seus próprios dados
 *
 * Cobre RBAC visual (regra 3 do acesso-e-autorizacao.md).
 */
test.skip('dashboard renderiza widgets diferentes por role respeitando RBAC', async () => {
  // implementação Sprint 07
})
