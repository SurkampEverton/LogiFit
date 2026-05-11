import { test } from '@playwright/test'

/**
 * critical/revoke-passport-link — paciente revoga vínculo cross-tenant +
 * cessam acessos cross-tenant imediatamente (regra 42 + ADR 0077).
 * Bloqueia deploy prod se falhar (ADR 0090 §5).
 *
 * Cenário:
 *   1. Paciente P tem patient_company_link ativo entre A (academia) e B (fisio)
 *   2. Fisio de B tem cache aberto com dados resumidos de A
 *   3. P entra em /app/eu/vinculos e clica "revogar vínculo com A"
 *   4. dialog confirma → patient_company_link.status='revoked', revoked_at=now()
 *   5. dispatcher publica evento `passport.revoked` → caches de B invalidados
 *   6. fisio de B tenta SELECT cross-tenant dados de A → 0 rows (link inativo)
 *   7. patient_data_access_log grava (action='revoke', actor=paciente_P)
 *   8. dado HISTÓRICO já consultado por B antes da revogação fica em B
 *      (resumido já consumido — irrecuperável; LGPD direito ao esquecimento
 *      cobre futuro, não retroativo)
 *
 * Cobre regra 42 + LGPD art. 18 (direito de oposição/revogação).
 */
test.skip('paciente revoga vínculo; cross-tenant reads cessam imediatamente', async () => {
  // implementação Sprint 01b (após patient_company_links)
})
