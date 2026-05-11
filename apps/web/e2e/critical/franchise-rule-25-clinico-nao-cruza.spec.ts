import { test } from '@playwright/test'

/**
 * critical/franchise-rule-25-clinico-nao-cruza — em franquia, dado clínico
 * NUNCA cruza company mesmo dentro do mesmo tenant (regra 25 do CLAUDE.md +
 * docs/multiempresa.md).
 * Bloqueia deploy prod se falhar (ADR 0090 §5).
 *
 * Cenário (seed: franquia-classica):
 *   1. Tenant `franquia-fisio-norte` com `topology='franchise'`,
 *      `cross_company_access=true` (financeiro cruza), 2 companies
 *      Filial-Centro + Filial-Norte
 *   2. fisio_centro autenticado com permission `evolucao.read` no tenant
 *   3. tenta SELECT evolutions WHERE company_id=Norte (mesmo tenant!)
 *      → 0 rows (RLS clínico checa company_id, não só tenant_id)
 *   4. faturamento de evolução de Norte aparece consolidado pro DRE da matriz
 *      (financeiro cruza company)
 *   5. UPDATE clínico que tenta cross-company → exception raise (RLS BEFORE)
 *
 * Cobre regra 25: "clínico nunca cruza company em franchise".
 */
test.skip('franquia: fisio de filial A não lê evolução de filial B mesmo no mesmo tenant', async () => {
  // implementação Sprint 01a (após RLS policies + topology franchise)
})
