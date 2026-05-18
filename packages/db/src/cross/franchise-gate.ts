/**
 * Cross-alert lesão — gate de regra 25 (franchise nunca cruza company clínica).
 *   Sprint 27 Faixa B.1.
 *
 * Função pura `canCrossModuleAlert(input)` retorna decisão com motivo. Não toca
 * banco — caller (Server Action) busca o estado e passa pra função.
 *
 * **Regra 25** (CLAUDE.md + rules.md): em tenant `topology='franchise'`,
 * dados clínicos NUNCA atravessam company_id. Mesmo com `cross_module_share`
 * consentido, o alerta é bloqueado.
 *
 * **Cenários:**
 *   - tenant.topology='owned' + mesma company → permite
 *   - tenant.topology='owned' + companies diferentes → permite (rede)
 *   - tenant.topology='franchise' + mesma company → permite
 *   - tenant.topology='franchise' + companies diferentes → BLOQUEIA (regra 25)
 */

export type Topology = 'owned' | 'franchise'

export interface CrossModuleGateInput {
  topology: Topology
  /** Company da consulta clínica (origem do alerta) */
  sourceCompanyId: string
  /** Company onde está o contrato Academia (destino — workout) */
  targetCompanyId: string
  /** True se member_consents com purpose='cross_module_share' ativo */
  hasConsent: boolean
  /** True se member tem contracts.status='active' em module 'academia' */
  hasActiveAcademiaContract: boolean
  /** True se há workout ativo prescrito ao member (prescriptions.active=true) */
  hasActiveWorkout: boolean
}

export type GateDecision =
  | { ok: true }
  | {
      ok: false
      blockedReason:
        | 'regra_25_franchise_cross_company'
        | 'consent_missing'
        | 'no_active_academia_contract'
        | 'no_active_workout'
    }

export function canCrossModuleAlert(input: CrossModuleGateInput): GateDecision {
  // Regra 25 é o primeiro gate — domina sobre consent (regulatório CFM/COFFITO)
  if (input.topology === 'franchise' && input.sourceCompanyId !== input.targetCompanyId) {
    return { ok: false, blockedReason: 'regra_25_franchise_cross_company' }
  }
  if (!input.hasConsent) {
    return { ok: false, blockedReason: 'consent_missing' }
  }
  if (!input.hasActiveAcademiaContract) {
    return { ok: false, blockedReason: 'no_active_academia_contract' }
  }
  if (!input.hasActiveWorkout) {
    return { ok: false, blockedReason: 'no_active_workout' }
  }
  return { ok: true }
}

// ─── CID classifier: filtra CIDs "actionable" (lesão musculoesquelética) ──

/**
 * Apenas CIDs MG (sintomas musculoesqueléticos), FB (sintomas neurológicos)
 * e FA (dor crônica) disparam cross-alert lesão na Sprint 27. Outras
 * categorias (cardiovascular, respiratório, mental) NÃO viram alerta de
 * adaptação de treino — exigem fluxo diferente (Sprint 27+ amplia).
 *
 * Chapters CID-11 relevantes pra adaptação de exercício:
 *   - MG — Sintomas, sinais e achados anormais relacionados aos sistemas
 *     musculoesquelético, articular e do tecido conjuntivo
 *   - FA — Dor crônica
 *   - FB — Sintomas, sinais e achados anormais do sistema nervoso
 *   - 22 — Lesões, envenenamentos e outras consequências de causas externas
 *     (capítulo CID-11 dedicado a lesões)
 *   - NB — Lesão de cabeça, pescoço, tronco, etc. (sub-chapter de 22)
 *
 * **MVP simplificado:** match por chapter prefix em vez de tabela enum.
 * Sprint 27b: lookup table dedicada `cid_chapter_actionable` curada.
 */
const ACTIONABLE_CHAPTERS = new Set(['MG', 'FA', 'FB', 'NB'])
const ACTIONABLE_PREFIXES = ['22', 'ND', 'NE', 'NF']

export function isActionableCid(chapter: string | null, code: string): boolean {
  if (!chapter && !code) return false
  const ch = chapter ?? code.slice(0, 2)
  if (ACTIONABLE_CHAPTERS.has(ch)) return true
  for (const p of ACTIONABLE_PREFIXES) {
    if (code.startsWith(p)) return true
  }
  return false
}
