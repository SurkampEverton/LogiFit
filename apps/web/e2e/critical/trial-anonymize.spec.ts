import { test } from '@playwright/test'

/**
 * critical/trial-anonymize — após 30 dias sem conversão, dados PII anonimizam
 * mantendo agregados estatísticos (ADR 0054 + Sprint 01a).
 * Bloqueia deploy prod se falhar (ADR 0090 §5).
 *
 * Cenário:
 *   1. cria tenant trial em 2026-01-01 (helpers/time.ts freezeAt)
 *   2. trial expira em 2026-01-15 (14 dias)
 *   3. avança clock pra 2026-02-15 (T0 + 31 dias)
 *   4. cron anonymize-trials roda
 *   5. SELECT * FROM members WHERE tenant_id = trial_id → email/cpf/nome estão nullified
 *      ou hashed; created_at/plano/módulos preservados
 *   6. SELECT count(*) FROM members WHERE tenant_id = trial_id agrupa por created_at
 *      retorna o mesmo número (agregado preservado)
 *
 * Justificativa LGPD: minimização de dados art. 6 IX + retenção art. 16.
 */
test.skip('trial expirado +30d anonymiza PII mas preserva agregados estatísticos', async () => {
  // implementação Sprint 01a (após `anonymize_tenant_pii()` SQL function)
})
