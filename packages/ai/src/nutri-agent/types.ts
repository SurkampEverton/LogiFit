/**
 * Nutri-Agent — tipos canônicos (ADR 0043 + 0044).
 *
 * Snapshot dos dados que o agent consulta cross-module. Reusa tipos das
 * libs puras dos Sprints upstream (29 nutri, 30 lab, 31 diário, 32 device, 33 exames).
 */

export interface MemberDemographics {
  ageYears: number
  sex: 'male' | 'female' | 'any'
  /** kg — última antropometria oficial */
  weightKg?: number | null
  /** cm — última altura cadastrada */
  heightCm?: number | null
  /** Trend (kg/mês) — última 8 semanas */
  weightTrendKgPerMonth?: number | null
}

export interface MealPlanContext {
  id: string
  name: string
  goal: string
  targetKcal: number | null
  targetProteinG: number | null
  targetCarbG: number | null
  targetLipidG: number | null
  version: number
}

export interface DiaryDailySummary {
  date: string // YYYY-MM-DD
  totalKcal: number
  totalProteinG: number
  totalCarbG: number
  totalFatG: number
  mealsCount: number
  adherencePct: number | null
}

export interface WorkoutLoadSummary {
  /** kcal estimado/semana via MET */
  weeklyKcalEst: number
  sessionsCount: number
  /** % sessões completas (vs prescritas) */
  completionPct: number
}

export interface FisioActiveCid {
  cidCode: string
  description: string
  /** Data de assinatura da consulta */
  consultaSignedAt: string
}

export interface LabResultRecent {
  analyteCode: string
  analyteName: string
  value: number
  unit: string
  outOfRange: boolean
  direction: 'above' | 'below' | null
  collectedAt: string
}

export interface DeviceSummary {
  /** Média HR repouso últimos 7d */
  restingHrAvg7d?: number | null
  /** Média sono (min) últimos 7d */
  sleepAvg7d?: number | null
  /** Passos diários média 7d */
  stepsAvg7d?: number | null
  /** VFC média 7d */
  hrvAvg7d?: number | null
}

/**
 * Snapshot completo de contexto do member que o agent vê na run.
 * Persistido em `nutri_agent_metrics_snapshot.data` jsonb pra audit +
 * reprodutibilidade.
 */
export interface MemberContextSnapshot {
  memberId: string
  capturedAt: string
  demographics: MemberDemographics
  mealPlan: MealPlanContext | null
  diaryLast14d: DiaryDailySummary[]
  workoutLoad: WorkoutLoadSummary | null
  fisioActiveCids: FisioActiveCid[]
  labResultsRecent: LabResultRecent[]
  deviceSummary: DeviceSummary
  /** Lista de consents que cobrem o cruzamento de dados (LGPD audit) */
  consentsUsed: string[]
}

/**
 * Padrão detectado pelo pattern-detector.
 */
export interface DetectedRiskPattern {
  /** Code canônico (ex: 'deficit_calorico_extremo', 'overtraining_sugestivo') */
  code: string
  label: string
  description: string
  severity: 'info' | 'attention' | 'critical'
  confidence: number
  /** Evidência: lista de campos do snapshot que dispararam o padrão */
  evidence: Array<{
    source: string // ex: 'diary' | 'device' | 'lab' | 'workout'
    metric: string
    value: number | string
    threshold?: number | string
  }>
}

/**
 * Sugestão de ajuste pré-formatada (não persistida ainda — vira
 * `nutri_agent_suggestions` quando Server Action persiste).
 */
export interface AgentSuggestion {
  kind: 'plan_adjustment' | 'alert' | 'risk_pattern' | 'pre_consult_summary' | 'follow_up_exam'
  severity: 'info' | 'attention' | 'critical'
  title: string
  description: string
  evidence: DetectedRiskPattern['evidence']
  confidence: number
  /** Diff proposto para meal_plan (kind='plan_adjustment') */
  proposedChanges?: {
    targetKcalDelta?: number
    addMeals?: Array<{ name: string; suggestedKcal: number }>
    swapItems?: Array<{ fromItemId: string; reason: string }>
  } | null
}
