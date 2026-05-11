import { test } from '@playwright/test'

/**
 * critical/cross-tenant-audit-log — toda leitura cross-tenant grava em
 * patient_data_access_log (regra 42 + ADR 0077).
 * Bloqueia deploy prod se falhar (ADR 0090 §5).
 *
 * Cenário:
 *   1. Academia A e Clínica B são tenants distintos
 *   2. Paciente P tem patient_company_link ativo entre A e B (módulo academia + fisio)
 *   3. fisio de B faz SELECT de antropometria do paciente P (vem de A via passaporte)
 *   4. patient_data_access_log recebe linha:
 *      (origin_tenant_id=A, requesting_tenant_id=B, user_id=fisio_de_B,
 *       data_kind='antropometria', action='read', module='fisioterapia')
 *   5. lint cross-tenant-read-must-log valida que a query SQL veio de função
 *      que chama logCrossTenantAccess() — sem isso, build falha
 *
 * Implementa regra 42 + lint custom `cross-tenant-read-must-log`.
 */
test.skip('leitura cross-tenant grava patient_data_access_log sincronamente', async () => {
  // implementação Sprint 01a (após patient_company_links + log table)
})
