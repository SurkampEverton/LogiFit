import { test } from '@playwright/test'

/**
 * critical/passport-global-constraint — 1 módulo ativo por (paciente, módulo)
 * em TODA a rede LogiFit (regra 42 + ADR 0077).
 * Bloqueia deploy prod se falhar (ADR 0090 §5).
 *
 * Cenário:
 *   1. Paciente P já tem patient_link_modules ativo:
 *      (tenant=A, module=fisioterapia, status=active, responsavel_tecnico=CREFITO-1)
 *   2. Clínica C (tenant distinto) cria patient_company_link com paciente P
 *      + tenta ativar módulo fisioterapia
 *   3. constraint global dispara → modal aparece pro paciente: "você já tem
 *      fisioterapia ativa em A. Quer substituir por C?"
 *   4a. paciente recusa → permanece em A; tentativa de força via SQL direto
 *       → exception `EXCLUSIVE_MODULE_CONFLICT`
 *   4b. paciente aceita → A.status='inactive', C.status='active' (atômico)
 *
 * Implementa "constraint global" + dupla confirmação (regra 42).
 */
test.skip('módulo exclusivo bloqueia ativação duplicada e oferece substituição', async () => {
  // implementação Sprint 01b (após patient_link_modules)
})
