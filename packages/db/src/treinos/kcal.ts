/**
 * Calculadora de gasto calórico por sessão de treino — Sprint 11 Faixa B (ADR 0070).
 *
 * Fórmula MET clássica (Compendium of Physical Activities 2024):
 *
 *   kcal = MET × weight_kg × duration_hours
 *
 * Onde:
 *   - MET = average MET dos exercises executados (ponderado pelo número de sets)
 *   - weight_kg = peso do member; fallback 70kg quando antropometria ausente (Sprint 12)
 *   - duration_hours = (finished_at − started_at) em horas
 *
 * Usada em `finishSession()` Server Action pra preencher
 * `workout_sessions.calculated_kcal` automaticamente.
 *
 * **Edge cases conservadores:**
 *   - duration ≤ 0 → retorna 0
 *   - met inválido (≤0) → ignorado no average; se todos forem inválidos retorna 0
 *   - weight ≤ 0 → fallback 70kg
 *   - items vazios → retorna 0
 *
 * **Limites de validação clínica** (proteção contra absurdo):
 *   - Resultado clampeado em [0, 5000] kcal — sessão de 3h HIIT max ~2000-3000;
 *     valores acima indicam bug de input (duração negativa em ms vs s).
 */

export interface ExerciseMetSample {
  /** MET Compendium 2024. Faixa típica 2.0-12.0. */
  met: number
  /** Número de séries planejadas. Pondera o MET médio (mais séries = mais peso). */
  sets: number
}

export interface KcalCalcInput {
  /** Lista de exercises com MET + sets, na ordem em que aparecem no workout */
  items: ExerciseMetSample[]
  /** Peso do member em kg. ≤0 = fallback 70kg. */
  weightKg: number
  /** Duração total da sessão em minutos. ≤0 = retorna 0. */
  durationMin: number
}

export interface KcalCalcResult {
  /** Resultado clampeado [0, 5000] kcal. */
  kcal: number
  /** MET médio ponderado pelos sets — útil pra debug/audit. */
  averageMet: number
  /** Peso efetivamente usado (input ou fallback). */
  effectiveWeightKg: number
}

const FALLBACK_WEIGHT_KG = 70
const MAX_REASONABLE_KCAL = 5000

/**
 * Calcula kcal por sessão de treino.
 *
 * @example
 *   // Workout: 3 exercises (MET 5.0 × 3 sets, MET 6.0 × 4 sets, MET 4.0 × 3 sets)
 *   // Member 80kg, sessão 45min
 *   calculateKcalPerSession({
 *     items: [
 *       { met: 5.0, sets: 3 },
 *       { met: 6.0, sets: 4 },
 *       { met: 4.0, sets: 3 },
 *     ],
 *     weightKg: 80,
 *     durationMin: 45,
 *   })
 *   // → { kcal: 305.0, averageMet: 5.1, effectiveWeightKg: 80 }
 */
export function calculateKcalPerSession(input: KcalCalcInput): KcalCalcResult {
  const weightKg = input.weightKg > 0 ? input.weightKg : FALLBACK_WEIGHT_KG

  if (input.durationMin <= 0 || input.items.length === 0) {
    return { kcal: 0, averageMet: 0, effectiveWeightKg: weightKg }
  }

  // Média ponderada de MET pelos sets — só conta items com MET > 0
  let totalMetWeighted = 0
  let totalSets = 0
  for (const item of input.items) {
    if (item.met <= 0) continue
    const sets = item.sets > 0 ? item.sets : 0
    totalMetWeighted += item.met * sets
    totalSets += sets
  }

  if (totalSets === 0) {
    return { kcal: 0, averageMet: 0, effectiveWeightKg: weightKg }
  }

  const averageMet = totalMetWeighted / totalSets
  const durationHours = input.durationMin / 60
  const rawKcal = averageMet * weightKg * durationHours
  const kcal = Math.min(Math.max(rawKcal, 0), MAX_REASONABLE_KCAL)

  return {
    kcal: Math.round(kcal * 100) / 100, // 2 casas decimais
    averageMet: Math.round(averageMet * 100) / 100,
    effectiveWeightKg: weightKg,
  }
}
