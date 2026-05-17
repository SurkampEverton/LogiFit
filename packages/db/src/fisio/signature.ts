/**
 * Política de assinatura por profissão — Sprint 20 Faixa B.1 (ADR 0032 Accepted).
 *
 * Funções puras (sem DB; caller carrega `signaturePolicies` + opcional
 * `tenantOverrides` e passa).
 */
import { createHash } from 'node:crypto'

export type SignatureMode = 'icp_required' | 'icp_optional' | 'authenticated_lock'
export type LockMethod = 'icp_brasil_a1' | 'icp_brasil_a3' | 'authenticated_mfa'

export interface SignaturePolicyRow {
  profession: string
  mode: SignatureMode
  minCertLevel: 'A1' | 'A3' | null
  requiresMfa: boolean
  requiresAuditChain: boolean
  requiresAuthenticatedSession: boolean
  sourceNorm: string
  retentionYears: number
}

export interface TenantSignatureOverrideRow {
  tenantId: string
  profession: string
  modeOverride: SignatureMode // só 'icp_required' aceito pelo CHECK
}

/**
 * Resolve a política efetiva para uma (profession, tenant). Override só
 * permite endurecer (`icp_required`), nunca afrouxar.
 *
 * Mapping profession ← kind:
 *   - 'medico' → 'medico'
 *   - 'fisio' → 'fisio'
 *   - 'nutri' → 'nutri'
 *   - 'personal' → 'personal'
 *   - 'enfermeiro' → 'enfermeiro'
 *   - 'custom' → 'fisio' (fallback conservador — authenticated_lock)
 */
export function resolveSignaturePolicy(input: {
  professionOrKind: string
  policies: SignaturePolicyRow[]
  tenantOverrides: TenantSignatureOverrideRow[]
  tenantId: string
}): SignaturePolicyRow {
  const prof =
    input.professionOrKind === 'custom' ? 'fisio' : input.professionOrKind
  const base = input.policies.find((p) => p.profession === prof)
  if (!base) {
    throw new Error(
      `signature_policies sem entrada para profession=${prof} — rode db:seed pra popular`,
    )
  }
  const override = input.tenantOverrides.find(
    (o) => o.tenantId === input.tenantId && o.profession === prof,
  )
  if (override && override.modeOverride === 'icp_required' && base.mode !== 'icp_required') {
    return { ...base, mode: 'icp_required', minCertLevel: base.minCertLevel ?? 'A1' }
  }
  return base
}

/**
 * Decide o lockMethod válido para uma tentativa de fechamento. Lança erro
 * caso `attempt` viole a política.
 */
export function validateLockAttempt(input: {
  policy: SignaturePolicyRow
  attempt: 'icp_brasil_a1' | 'icp_brasil_a3' | 'authenticated_mfa'
  mfaRecentMs?: number // ms desde último MFA bem-sucedido (regra 43)
  hasActiveCouncil: boolean // ADR 0055 — gate de registro profissional
}): { ok: true; lockMethod: LockMethod } | { ok: false; reason: string } {
  if (!input.hasActiveCouncil) {
    return {
      ok: false,
      reason:
        'Profissional sem registro ativo no conselho compatível (CFM/COFFITO/CFN). Cadastre em /app/pessoas/[id]/registros.',
    }
  }

  if (input.policy.requiresMfa) {
    const fifteenMin = 15 * 60 * 1000
    if (input.mfaRecentMs == null || input.mfaRecentMs > fifteenMin) {
      return {
        ok: false,
        reason:
          'Política requer MFA recente (<15min). Re-autentique com TOTP/WebAuthn antes de assinar.',
      }
    }
  }

  if (input.policy.mode === 'icp_required') {
    if (input.attempt === 'authenticated_mfa') {
      return {
        ok: false,
        reason: `Profissão ${input.policy.profession} exige ICP-Brasil (norma ${input.policy.sourceNorm}). Lacre autenticado não aceito.`,
      }
    }
    if (input.policy.minCertLevel === 'A3' && input.attempt === 'icp_brasil_a1') {
      return {
        ok: false,
        reason: `Política exige certificado A3 (token/cartão). A1 não aceito (norma ${input.policy.sourceNorm}).`,
      }
    }
    return { ok: true, lockMethod: input.attempt }
  }

  if (input.policy.mode === 'authenticated_lock') {
    // Aceita qualquer attempt (mais conservador também passa)
    return { ok: true, lockMethod: input.attempt }
  }

  // icp_optional — qualquer modo válido
  return { ok: true, lockMethod: input.attempt }
}

/**
 * Hash SHA-256 do conteúdo de uma consulta (regra 39 — base pra audit chain).
 * Caller normaliza JSON antes (chaves ordenadas) pra garantir determinismo.
 */
export function hashConsultaContent(input: {
  content: Record<string, unknown>
  cids: Array<{ code: string; kind: string }>
  cifs: Array<{ code: string; qualifier: number }>
  signedAtIso: string
  professionalUserId: string
}): string {
  const canonical = {
    content: orderKeys(input.content),
    cids: input.cids
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code) || a.kind.localeCompare(b.kind)),
    cifs: input.cifs.slice().sort((a, b) => a.code.localeCompare(b.code)),
    signedAtIso: input.signedAtIso,
    professionalUserId: input.professionalUserId,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function orderKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[key] = orderKeys(v as Record<string, unknown>)
    } else {
      out[key] = v
    }
  }
  return out
}

// ─── Validadores CID/CIF ────────────────────────────────────────────────

export function validateCidCode(code: string): { ok: boolean; reason?: string } {
  // CID-11 segue padrão alfanumérico (ex: MG30.0, FB20, BA00). Tolerante.
  if (!code || code.length < 2 || code.length > 12) {
    return { ok: false, reason: 'CID code deve ter 2-12 caracteres' }
  }
  if (!/^[A-Z0-9.]+$/.test(code)) {
    return { ok: false, reason: 'CID code só aceita letras maiúsculas, dígitos e ponto' }
  }
  return { ok: true }
}

export function validateCifCode(code: string): { ok: boolean; reason?: string } {
  // CIF: letra (b/s/d/e) + 3 ou 4 dígitos + qualifier opcional .NN
  // body_structures usa 4 dígitos (ex: s7300); b/d/e usam 3 (ex: b280, d450, e310).
  if (!/^[bsde]\d{3,4}(\.\d{1,2})?$/.test(code)) {
    return {
      ok: false,
      reason: 'CIF code deve seguir padrão [bsde]NNN[.NN] (ex: b280, d450, s7300.21, e310)',
    }
  }
  return { ok: true }
}

export function validateCifQualifier(qualifier: number): { ok: boolean; reason?: string } {
  if (!Number.isInteger(qualifier) || qualifier < 0 || qualifier > 4) {
    return { ok: false, reason: 'Qualifier CIF deve ser inteiro entre 0 e 4' }
  }
  return { ok: true }
}
