/**
 * Device Hub normalizer — Sprint 32 Faixa B.1.
 *
 * Lib pura pra:
 *   - Validar valores de leitura (faixa fisiológica por observation_code)
 *   - Detectar leituras suspeitas (outliers além de ±3σ)
 *   - Agregar leituras por dia → device_readings_daily_summary (min/max/avg/count)
 *
 * Sem IO. Caller chama com arrays carregados.
 */

import type { NormalizedReading } from './provider'

// ─── Faixas fisiológicas por observation_code ──────────────────────────────

interface PhysiologicalRange {
  min: number
  max: number
  unit: string
}

export const PHYSIOLOGICAL_RANGES: Record<string, PhysiologicalRange> = {
  HR: { min: 30, max: 220, unit: 'bpm' },
  HR_RESTING: { min: 30, max: 110, unit: 'bpm' },
  HR_MAX: { min: 120, max: 220, unit: 'bpm' },
  VO2_MAX: { min: 10, max: 90, unit: 'ml/kg/min' },
  HRV: { min: 5, max: 200, unit: 'ms' },
  WEIGHT: { min: 20, max: 300, unit: 'kg' },
  BODY_FAT_PCT: { min: 3, max: 60, unit: '%' },
  MUSCLE_MASS_KG: { min: 5, max: 100, unit: 'kg' },
  SLEEP_DURATION_MIN: { min: 0, max: 1440, unit: 'min' },
  SLEEP_EFFICIENCY: { min: 0, max: 100, unit: '%' },
  STEPS: { min: 0, max: 100000, unit: 'steps' },
  DISTANCE_KM: { min: 0, max: 200, unit: 'km' },
  CALORIES_KCAL: { min: 0, max: 8000, unit: 'kcal' },
  READINESS_SCORE: { min: 0, max: 100, unit: 'score' },
  RECOVERY_SCORE: { min: 0, max: 100, unit: 'score' },
  GLUCOSE_MG_DL: { min: 30, max: 600, unit: 'mg/dL' },
  VELOCITY_M_S: { min: 0, max: 15, unit: 'm/s' },
  ROM_DEGREES: { min: 0, max: 180, unit: 'degrees' },
}

export interface ValidationResult {
  valid: boolean
  reason?: 'out_of_range' | 'unit_mismatch' | 'unknown_code'
  expectedRange?: PhysiologicalRange
}

/**
 * Valida uma leitura individual contra faixas fisiológicas.
 */
export function validateReading(r: NormalizedReading): ValidationResult {
  const range = PHYSIOLOGICAL_RANGES[r.observationCode]
  if (!range) {
    return { valid: false, reason: 'unknown_code' }
  }
  if (r.unit !== range.unit) {
    return { valid: false, reason: 'unit_mismatch', expectedRange: range }
  }
  if (r.value < range.min || r.value > range.max) {
    return { valid: false, reason: 'out_of_range', expectedRange: range }
  }
  return { valid: true }
}

/**
 * Filtra leituras válidas + retorna inválidas separadas (caller decide
 * tratamento — geralmente cria `device_incidents` kind='calibration_anomaly').
 */
export function partitionValidReadings(readings: NormalizedReading[]): {
  valid: NormalizedReading[]
  invalid: Array<NormalizedReading & { reason: ValidationResult['reason'] }>
} {
  const valid: NormalizedReading[] = []
  const invalid: Array<NormalizedReading & { reason: ValidationResult['reason'] }> = []
  for (const r of readings) {
    const v = validateReading(r)
    if (v.valid) valid.push(r)
    else invalid.push({ ...r, reason: v.reason })
  }
  return { valid, invalid }
}

// ─── Agregação diária ──────────────────────────────────────────────────────

export interface DailyAggregate {
  observationCode: string
  observedDate: string // YYYY-MM-DD
  minValue: number
  maxValue: number
  avgValue: number
  samplesCount: number
  unit: string
}

/**
 * Agrupa leituras por (observation_code, observed_date) e calcula stats.
 * Usado pelo cron `aggregate-daily-summaries` antes do drop diário.
 */
export function aggregateDailySummaries(readings: NormalizedReading[]): DailyAggregate[] {
  const byKey = new Map<string, NormalizedReading[]>()
  for (const r of readings) {
    const date = r.measuredAt.slice(0, 10)
    const key = `${r.observationCode}|${date}|${r.unit}`
    const arr = byKey.get(key) ?? []
    arr.push(r)
    byKey.set(key, arr)
  }

  const out: DailyAggregate[] = []
  for (const [key, rs] of byKey.entries()) {
    const [code, date, unit] = key.split('|')
    const values = rs.map((r) => r.value)
    out.push({
      observationCode: code!,
      observedDate: date!,
      minValue: Math.min(...values),
      maxValue: Math.max(...values),
      avgValue: round3(values.reduce((s, v) => s + v, 0) / values.length),
      samplesCount: values.length,
      unit: unit!,
    })
  }
  return out
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

// ─── Detecção de outliers ──────────────────────────────────────────────────

export interface OutlierFlag {
  reading: NormalizedReading
  reason: 'beyond_3_sigma' | 'sudden_jump' | 'physiologically_impossible'
  zScore?: number
}

/**
 * Detecta outliers em série temporal usando ±3σ contra média/std da janela.
 * Caller passa janela típica (ex: últimos 30 dias do mesmo observation_code).
 */
export function detectOutliers(
  newReadings: NormalizedReading[],
  baseline: number[],
): OutlierFlag[] {
  if (baseline.length < 5) {
    // Sem dados suficientes pra estatística confiável; valida só faixa
    return newReadings
      .filter((r) => !validateReading(r).valid)
      .map((r) => ({ reading: r, reason: 'physiologically_impossible' as const }))
  }
  const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length
  const variance = baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / baseline.length
  const std = Math.sqrt(variance)
  if (std === 0) return []

  const out: OutlierFlag[] = []
  for (const r of newReadings) {
    const z = (r.value - mean) / std
    if (Math.abs(z) > 3) {
      out.push({
        reading: r,
        reason: 'beyond_3_sigma',
        zScore: Math.round(z * 100) / 100,
      })
    }
  }
  return out
}
