/**
 * `requireRecentMfa()` — gate de MFA recente pra ações high-risk (regra 43).
 *
 * Toda Server Action listada em `HIGH_RISK_ACTIONS` deve chamar este helper
 * ANTES da lógica. Sem MFA recente (`<15min` default), retorna envelope
 * `MFA_RECENT_REQUIRED` (ADR 0071).
 *
 * Fluxo:
 *   1. Server Action lê `sessionContext` (de `wrapAction()` — Faixa F)
 *   2. Chama `requireRecentMfa({ session, maxAgeMins })`
 *   3. Helper checa `session.mfaAt` vs `Date.now() - maxAgeMins*60_000`
 *   4. Falha → throw `MfaRecentRequiredError` (capturado pelo wrapper → envelope)
 *
 * UI dispara modal "re-autenticar com TOTP" quando recebe esse erro;
 * após TOTP válido, BetterAuth atualiza `session.mfaAt` → retry succeeds.
 *
 * Lint `high-risk-action-must-require-recent-mfa` (scripts/lint-custom.mjs)
 * bloqueia commit se Server Action listada em high-risk-actions.ts não
 * chamar este helper.
 */

import { getHighRiskAction } from './high-risk-actions'

export class MfaRecentRequiredError extends Error {
  readonly code = 'MFA_RECENT_REQUIRED'
  readonly maxAgeMins: number
  readonly mfaAt: Date | null

  constructor(message: string, opts: { maxAgeMins: number; mfaAt: Date | null }) {
    super(message)
    this.name = 'MfaRecentRequiredError'
    this.maxAgeMins = opts.maxAgeMins
    this.mfaAt = opts.mfaAt
  }
}

export interface MfaCheckSession {
  /** Timestamp do último TOTP/WebAuthn successful (null se nunca completou MFA) */
  mfaAt: Date | null
  /** Identidade auth (BetterAuth user.id) — usado em audit */
  authUserId: string
}

export interface RequireRecentMfaOptions {
  /** Janela máxima desde `mfaAt` (default 15 minutos — regra 43) */
  maxAgeMins?: number
}

/**
 * Lança `MfaRecentRequiredError` se `session.mfaAt` for null ou mais antigo
 * que `maxAgeMins` (default 15 min).
 *
 * Uso típico em Server Action:
 *   requireRecentMfa({ session })  // default 15min
 *   requireRecentMfa({ session, maxAgeMins: 5 })  // ação ultra-sensível
 *
 * Versão `forAction()` pra inferir `maxAgeMins` da lista canônica de
 * `HIGH_RISK_ACTIONS` automaticamente.
 */
export function requireRecentMfa(
  session: MfaCheckSession,
  options: RequireRecentMfaOptions = {},
): void {
  const maxAgeMins = options.maxAgeMins ?? 15

  if (!session.mfaAt) {
    throw new MfaRecentRequiredError('MFA enrollment required for this action', {
      maxAgeMins,
      mfaAt: null,
    })
  }

  const ageMs = Date.now() - session.mfaAt.getTime()
  const maxAgeMs = maxAgeMins * 60_000

  if (ageMs > maxAgeMs) {
    throw new MfaRecentRequiredError(
      `MFA verification expired (last ${Math.round(ageMs / 60_000)}min ago, max ${maxAgeMins}min)`,
      { maxAgeMins, mfaAt: session.mfaAt },
    )
  }
}

/**
 * Versão tipada por ação — busca `maxAgeMins` em `HIGH_RISK_ACTIONS` lookup table.
 * Se ação não estiver listada (não é high-risk), retorna sem checar.
 *
 * Uso típico (preferido sobre `requireRecentMfa` direto):
 *   await requireRecentMfaForAction(session, 'cancelNfe')
 */
export function requireRecentMfaForAction(
  session: MfaCheckSession,
  actionName: string,
): void {
  const action = getHighRiskAction(actionName)
  if (!action) return // não é high-risk — passa direto
  requireRecentMfa(session, { maxAgeMins: action.requireMfaMaxAgeMins })
}

/** Helper boolean — útil em UI/Server Component decidir se mostrar modal de re-auth */
export function isMfaRecent(session: MfaCheckSession | null, maxAgeMins = 15): boolean {
  if (!session?.mfaAt) return false
  return Date.now() - session.mfaAt.getTime() <= maxAgeMins * 60_000
}
