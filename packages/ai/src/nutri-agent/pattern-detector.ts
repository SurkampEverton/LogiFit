/**
 * Nutri-Agent pattern detector — Sprint 34 Faixa B.1.
 *
 * Função pura `detectRiskPatterns(snapshot)` cruza dados do snapshot
 * e detecta padrões de risco curados. Mesma estratégia do Sprint 33
 * `detectPatterns` (catálogo curado > IA generativa):
 *   - Determinístico + auditável
 *   - Reprodutível dado mesmo snapshot
 *   - Curadoria nutricional explícita
 *
 * Sprint 34b: IA Gemini Flash sugere padrões adicionais quando catálogo não
 * cobre (sempre passa por classifier anti-diagnóstico Sprint 33).
 */

import type { DetectedRiskPattern, MemberContextSnapshot } from './types'

// ─── Regras curadas ─────────────────────────────────────────────────────

/**
 * Détalhe calórico extremo: paciente comendo <70% do target consistentemente.
 */
function checkExtremeCaloricDeficit(s: MemberContextSnapshot): DetectedRiskPattern | null {
  const plan = s.mealPlan
  if (!plan?.targetKcal) return null
  if (s.diaryLast14d.length < 7) return null

  const recent = s.diaryLast14d.slice(0, 7)
  const avgKcal = recent.reduce((sum, d) => sum + d.totalKcal, 0) / recent.length
  const ratio = avgKcal / plan.targetKcal

  if (ratio >= 0.7) return null

  const severity: DetectedRiskPattern['severity'] = ratio < 0.5 ? 'critical' : 'attention'
  return {
    code: 'deficit_calorico_extremo',
    label: 'Déficit calórico extremo',
    description:
      'Paciente consumindo significativamente menos calorias que o target do plano. Risco de deficiência nutricional e adaptação metabólica. Reavaliar plano ou aderência.',
    severity,
    confidence: 0.95,
    evidence: [
      { source: 'diary', metric: 'avg_kcal_7d', value: Math.round(avgKcal) },
      { source: 'meal_plan', metric: 'target_kcal', value: plan.targetKcal },
      {
        source: 'computed',
        metric: 'ratio',
        value: Math.round(ratio * 100) / 100,
        threshold: 0.7,
      },
    ],
  }
}

/**
 * Aderência consistentemente baixa: <50% nos últimos 7 dias.
 */
function checkLowAdherence(s: MemberContextSnapshot): DetectedRiskPattern | null {
  const recent = s.diaryLast14d.slice(0, 7).filter((d) => d.adherencePct != null)
  if (recent.length < 4) return null

  const avgAdh = recent.reduce((sum, d) => sum + (d.adherencePct ?? 0), 0) / recent.length
  if (avgAdh >= 50) return null

  return {
    code: 'aderencia_baixa',
    label: 'Aderência baixa ao plano',
    description:
      'Paciente cumpriu menos de 50% das refeições planejadas nos últimos 7 dias. Avaliar barreiras (horário, sabor, custo, motivação) ou reavaliar viabilidade do plano.',
    severity: avgAdh < 30 ? 'attention' : 'info',
    confidence: 0.92,
    evidence: [
      { source: 'diary', metric: 'avg_adherence_pct_7d', value: Math.round(avgAdh) },
      { source: 'computed', metric: 'threshold', value: 50, threshold: 50 },
    ],
  }
}

/**
 * Overtraining sugestivo: HR repouso elevado >+10bpm vs baseline + sono baixo.
 * Requer device data.
 */
function checkOvertrainingSuggestion(s: MemberContextSnapshot): DetectedRiskPattern | null {
  const dev = s.deviceSummary
  if (dev.restingHrAvg7d == null || dev.sleepAvg7d == null) return null

  // Heurística simplificada: HR>75 + sono <360min (6h)
  const hrFlag = dev.restingHrAvg7d > 75
  const sleepFlag = dev.sleepAvg7d < 360

  if (!hrFlag || !sleepFlag) return null

  return {
    code: 'overtraining_sugestivo',
    label: 'Padrão sugestivo de overtraining',
    description:
      'HR de repouso elevado + sono insuficiente. Avaliar volume de treino e recuperação. Padrão pode indicar fadiga acumulada — discutir com instrutor + nutricionista.',
    severity: 'attention',
    confidence: 0.78,
    evidence: [
      { source: 'device', metric: 'resting_hr_avg_7d', value: dev.restingHrAvg7d, threshold: 75 },
      { source: 'device', metric: 'sleep_avg_7d_min', value: dev.sleepAvg7d, threshold: 360 },
    ],
  }
}

/**
 * Risco cardiovascular: lab recente com perfil aterogênico + diet alta gordura saturada.
 */
function checkCardiovascularRisk(s: MemberContextSnapshot): DetectedRiskPattern | null {
  const ldlOor = s.labResultsRecent.find(
    (l) => l.analyteCode === 'ldl' && l.outOfRange && l.direction === 'above',
  )
  const hdlOor = s.labResultsRecent.find(
    (l) => l.analyteCode === 'hdl' && l.outOfRange && l.direction === 'below',
  )

  if (!ldlOor || !hdlOor) return null

  return {
    code: 'risco_cardiovascular_lipidico',
    label: 'Risco cardiovascular lipídico',
    description:
      'LDL elevado + HDL baixo nos exames recentes. Revisar gordura saturada e fibras no plano. Combinar com avaliação clínica (médico/nutri).',
    severity: 'attention',
    confidence: 0.88,
    evidence: [
      { source: 'lab', metric: 'ldl_value', value: ldlOor.value },
      { source: 'lab', metric: 'hdl_value', value: hdlOor.value },
      { source: 'lab', metric: 'collected_at', value: ldlOor.collectedAt },
    ],
  }
}

/**
 * Risco glicêmico: glicose ou HbA1c elevados + plano alta carga carbo.
 */
function checkGlycemicRisk(s: MemberContextSnapshot): DetectedRiskPattern | null {
  const glicemiaOor = s.labResultsRecent.find(
    (l) =>
      (l.analyteCode === 'glicose_jejum' || l.analyteCode === 'hba1c') &&
      l.outOfRange &&
      l.direction === 'above',
  )
  if (!glicemiaOor) return null

  return {
    code: 'risco_glicemico',
    label: 'Risco glicêmico detectado',
    description:
      'Marcadores de glicemia elevados nos exames. Revisar carboidratos refinados + frequência de refeições no plano. Avaliar HOMA-IR + acompanhamento médico.',
    severity: 'attention',
    confidence: 0.86,
    evidence: [
      { source: 'lab', metric: glicemiaOor.analyteCode, value: glicemiaOor.value },
      { source: 'lab', metric: 'collected_at', value: glicemiaOor.collectedAt },
    ],
  }
}

/**
 * Perda de peso rápida: > 1.5 kg/semana — risco de massa muscular.
 */
function checkRapidWeightLoss(s: MemberContextSnapshot): DetectedRiskPattern | null {
  const trend = s.demographics.weightTrendKgPerMonth
  if (trend == null) return null
  // -6 kg/mês = -1.5 kg/semana
  if (trend > -6) return null

  return {
    code: 'perda_peso_rapida',
    label: 'Perda de peso acima do recomendado',
    description:
      'Trend de perda > 1.5 kg/semana. Acima do recomendado (0.5-1 kg/semana). Risco de perda muscular + adaptação metabólica + reganho. Reavaliar déficit + proteína + treino.',
    severity: 'attention',
    confidence: 0.9,
    evidence: [
      { source: 'computed', metric: 'weight_trend_kg_per_month', value: trend, threshold: -6 },
    ],
  }
}

/**
 * Fisio com restrição motora ativa + workout alto volume = revisar plano nutricional pra recuperação.
 */
function checkFisioWorkoutTension(s: MemberContextSnapshot): DetectedRiskPattern | null {
  if (s.fisioActiveCids.length === 0) return null
  if (!s.workoutLoad) return null
  // 5+ sessões/sem com lesão ativa
  if (s.workoutLoad.sessionsCount < 5) return null

  return {
    code: 'fisio_workout_tensao',
    label: 'Lesão ativa + carga de treino elevada',
    description:
      'Paciente em tratamento fisioterápico (CIDs ativos) mas mantendo alta carga de treino. Reforçar aporte proteico + recuperação. Coordenar com fisio.',
    severity: 'info',
    confidence: 0.75,
    evidence: [
      { source: 'fisio', metric: 'active_cids_count', value: s.fisioActiveCids.length },
      {
        source: 'workout',
        metric: 'sessions_count',
        value: s.workoutLoad.sessionsCount,
        threshold: 5,
      },
    ],
  }
}

// ─── Detector principal ─────────────────────────────────────────────────

const ALL_DETECTORS = [
  checkExtremeCaloricDeficit,
  checkLowAdherence,
  checkOvertrainingSuggestion,
  checkCardiovascularRisk,
  checkGlycemicRisk,
  checkRapidWeightLoss,
  checkFisioWorkoutTension,
] as const

/**
 * Roda todos os detectores curados; retorna padrões ativos ordenados por
 * severidade (critical → attention → info).
 */
export function detectRiskPatterns(snapshot: MemberContextSnapshot): DetectedRiskPattern[] {
  const found: DetectedRiskPattern[] = []
  for (const detector of ALL_DETECTORS) {
    const r = detector(snapshot)
    if (r) found.push(r)
  }
  // Ordena por severidade
  const severityRank: Record<DetectedRiskPattern['severity'], number> = {
    critical: 3,
    attention: 2,
    info: 1,
  }
  return found.sort((a, b) => severityRank[b.severity] - severityRank[a.severity])
}
