/**
 * Ações de alto risco que exigem MFA recente <15min (regra 43 + ADR 0073).
 *
 * Lint custom `high-risk-action-must-require-recent-mfa` (Faixa 4) bloqueia
 * commit se Server Action listada aqui não chamar `requireRecentMfa()` antes
 * da lógica.
 *
 * Ações com `alsoBlockedFromAi: true` têm dupla proteção (regra 41 + 43):
 *   - IA nunca chega ao handler (lint `ai-block-respected` — handler tem
 *     comentário `// ai-blocked: <motivo>`).
 *   - Se chegasse via bypass, gate MFA pegaria (camadas independentes).
 *
 * Adicionar nova ação aqui exige ADR (regras 43 + 41 dependem desta tabela).
 */

export type HighRiskCategory = 'fiscal' | 'rbac' | 'financeiro' | 'compliance' | 'super-admin'

export interface HighRiskAction {
  action: string
  requireMfaMaxAgeMins: number
  category: HighRiskCategory
  alsoBlockedFromAi?: boolean
}

export const HIGH_RISK_ACTIONS: readonly HighRiskAction[] = [
  // Fiscal — sprint 22 (TISS), 36 (Focus NFe)
  { action: 'cancelTissGuide', requireMfaMaxAgeMins: 15, category: 'fiscal' },
  { action: 'cancelNfe', requireMfaMaxAgeMins: 15, category: 'fiscal' },

  // Financeiro — sprint 04 (Asaas), 06 (cobrança), 17 (Open Finance)
  { action: 'voidPaidInvoice', requireMfaMaxAgeMins: 15, category: 'financeiro' },
  { action: 'updateInvoiceAmount', requireMfaMaxAgeMins: 15, category: 'financeiro' },
  { action: 'updateAsaasKey', requireMfaMaxAgeMins: 15, category: 'financeiro' },
  { action: 'configureBillingByok', requireMfaMaxAgeMins: 15, category: 'financeiro' },
  {
    action: 'runOpenFinancePayment',
    requireMfaMaxAgeMins: 15,
    category: 'financeiro',
    alsoBlockedFromAi: true,
  },

  // RBAC — sprint 01b
  { action: 'updateUserRole', requireMfaMaxAgeMins: 15, category: 'rbac' },
  { action: 'createCustomRole', requireMfaMaxAgeMins: 15, category: 'rbac' },
  { action: 'grantUserPermission', requireMfaMaxAgeMins: 15, category: 'rbac' },

  // Compliance — sprint 01a (anonymize), 20+ (clínico)
  {
    action: 'anonymizeMember',
    requireMfaMaxAgeMins: 15,
    category: 'compliance',
    alsoBlockedFromAi: true,
  },
  {
    action: 'deleteClinicalData',
    requireMfaMaxAgeMins: 15,
    category: 'compliance',
    alsoBlockedFromAi: true,
  },
  {
    action: 'exportFullProntuario',
    requireMfaMaxAgeMins: 15,
    category: 'compliance',
    alsoBlockedFromAi: true,
  },

  // Super-admin (suporte LogiFit cross-tenant) — Sprint 00b+
  { action: 'terminateTenant', requireMfaMaxAgeMins: 15, category: 'super-admin' },
  { action: 'openPamSession', requireMfaMaxAgeMins: 15, category: 'super-admin' },
  { action: 'restoreBackup', requireMfaMaxAgeMins: 15, category: 'super-admin' },
] as const

export const HIGH_RISK_ACTION_NAMES: ReadonlySet<string> = new Set(
  HIGH_RISK_ACTIONS.map((a) => a.action),
)

export function isHighRiskAction(name: string): boolean {
  return HIGH_RISK_ACTION_NAMES.has(name)
}

export function getHighRiskAction(name: string): HighRiskAction | undefined {
  return HIGH_RISK_ACTIONS.find((a) => a.action === name)
}
