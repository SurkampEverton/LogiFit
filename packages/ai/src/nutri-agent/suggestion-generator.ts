/**
 * Nutri-Agent suggestion generator — Sprint 34 Faixa B.1.
 *
 * Converte padrões detectados em sugestões acionáveis (AgentSuggestion[]).
 * Conservador: cada sugestão é proposta, NUNCA write direto (ADR 0044).
 *
 * Reusa classifier anti-diagnóstico do Sprint 33 antes de retornar.
 */

import type { AgentSuggestion, DetectedRiskPattern, MemberContextSnapshot } from './types'

/**
 * Mapeia code de pattern → kind canônico de suggestion.
 */
const PATTERN_TO_KIND: Record<string, AgentSuggestion['kind']> = {
  deficit_calorico_extremo: 'plan_adjustment',
  aderencia_baixa: 'alert',
  overtraining_sugestivo: 'risk_pattern',
  risco_cardiovascular_lipidico: 'plan_adjustment',
  risco_glicemico: 'plan_adjustment',
  perda_peso_rapida: 'plan_adjustment',
  fisio_workout_tensao: 'plan_adjustment',
}

/**
 * Para cada padrão, gera sugestão acionável. Proposta de plan_adjustment
 * vira `proposedChanges` (diff sobre meal_plan ativo). Outros viram alert/
 * risk_pattern sem changes.
 */
export function generateSuggestionsFromPatterns(
  patterns: DetectedRiskPattern[],
  snapshot: MemberContextSnapshot,
): AgentSuggestion[] {
  const out: AgentSuggestion[] = []
  for (const p of patterns) {
    const kind = PATTERN_TO_KIND[p.code] ?? 'alert'
    const base: AgentSuggestion = {
      kind,
      severity: p.severity,
      title: p.label,
      description: p.description,
      evidence: p.evidence,
      confidence: p.confidence,
      proposedChanges: null,
    }

    if (kind === 'plan_adjustment') {
      base.proposedChanges = computeProposedChanges(p, snapshot)
    }

    out.push(base)
  }
  return out
}

/**
 * Calcula proposedChanges conservador por padrão.
 */
function computeProposedChanges(
  pattern: DetectedRiskPattern,
  snapshot: MemberContextSnapshot,
): AgentSuggestion['proposedChanges'] {
  const plan = snapshot.mealPlan
  if (!plan) return null

  switch (pattern.code) {
    case 'deficit_calorico_extremo': {
      // Sugere subir o target para o consumo médio + 10% (chegar perto do que está real)
      const avgKcalEv = pattern.evidence.find((e) => e.metric === 'avg_kcal_7d')
      const avgKcal = typeof avgKcalEv?.value === 'number' ? avgKcalEv.value : null
      if (!avgKcal || !plan.targetKcal) return null
      const newTarget = Math.round(avgKcal * 1.1)
      return {
        targetKcalDelta: newTarget - plan.targetKcal,
      }
    }
    case 'risco_cardiovascular_lipidico':
    case 'risco_glicemico':
    case 'fisio_workout_tensao':
      // Plan_adjustment sem changes específicas — profissional decide
      return null
    case 'perda_peso_rapida': {
      // Sugere subir target em +200kcal para frear perda
      return { targetKcalDelta: 200 }
    }
    default:
      return null
  }
}

/**
 * Gera pre-consult summary: 1 sugestão única tipo 'pre_consult_summary'
 * com resumo executivo de tudo.
 */
export function generatePreConsultSummary(
  patterns: DetectedRiskPattern[],
  snapshot: MemberContextSnapshot,
): AgentSuggestion {
  const lines: string[] = []
  if (snapshot.mealPlan) {
    lines.push(
      `Plano ativo: ${snapshot.mealPlan.name} (target ${snapshot.mealPlan.targetKcal ?? '?'} kcal, v${snapshot.mealPlan.version})`,
    )
  } else {
    lines.push('Sem plano alimentar ativo.')
  }

  if (snapshot.diaryLast14d.length > 0) {
    const adherent = snapshot.diaryLast14d.filter(
      (d) => d.adherencePct != null && d.adherencePct >= 80,
    )
    lines.push(
      `Diário 14d: ${snapshot.diaryLast14d.length} dias registrados, ${adherent.length} com adherence ≥ 80%.`,
    )
  } else {
    lines.push('Sem registros recentes no diário alimentar.')
  }

  if (snapshot.fisioActiveCids.length > 0) {
    lines.push(`CIDs fisio ativos: ${snapshot.fisioActiveCids.map((c) => c.cidCode).join(', ')}`)
  }

  if (snapshot.labResultsRecent.length > 0) {
    const oor = snapshot.labResultsRecent.filter((l) => l.outOfRange)
    if (oor.length > 0) {
      lines.push(`Exames recentes alterados: ${oor.map((l) => l.analyteCode).join(', ')}`)
    }
  }

  if (patterns.length > 0) {
    lines.push(
      `Padrões detectados (${patterns.length}): ${patterns.map((p) => p.label).join('; ')}`,
    )
  }

  return {
    kind: 'pre_consult_summary',
    severity: patterns.some((p) => p.severity === 'critical')
      ? 'critical'
      : patterns.some((p) => p.severity === 'attention')
        ? 'attention'
        : 'info',
    title: 'Resumo pré-consulta',
    description: lines.join('\n'),
    evidence: patterns.flatMap((p) => p.evidence).slice(0, 10),
    confidence: 1.0, // Resumo determinístico
    proposedChanges: null,
  }
}
