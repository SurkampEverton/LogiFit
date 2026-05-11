import { test } from '@playwright/test'

/**
 * smoke/mfa-recent-required — ações high-risk exigem MFA <15min (regra 43).
 * Bloqueia merge se falhar (ADR 0090 §6).
 *
 * Cenário:
 *   1. tenant_owner loga + completa MFA → mfa_at = T0
 *   2. avança clock 20min (helpers/time.ts freezeAt)
 *   3. tenta `cancelNfe` → 403 + envelope `MFA_RECENT_REQUIRED` (não 'FORBIDDEN')
 *   4. UI mostra Toast "ação exige re-autenticação" + abre TOTP dialog
 *   5. TOTP válido → mfa_at = T1 → retry succeeds
 *
 * Cobre regra 43 + ADR 0073 camada 2 + `packages/security/high-risk-actions.ts`.
 * Lista de ações high-risk (com `requireMfaMaxAgeMins=15` default):
 * cancelTissGuide, cancelNfe, voidPaidInvoice, updateUserRole, runOpenFinancePayment,
 * anonymizeMember, deleteClinicalData, exportFullProntuario, terminateTenant,
 * openPamSession, restoreBackup.
 */
test.skip('cancelNfe com MFA stale (>15min) retorna MFA_RECENT_REQUIRED + reattempt OK', async () => {
  // implementação após Sprint 01a (MFA) + Sprint 17 (cancelNfe)
})
