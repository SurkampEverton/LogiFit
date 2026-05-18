/**
 * Lab — Sprint 30 Faixa B.1 (ADR 0082).
 *
 * Funções puras:
 *   - matchReferenceRange(ranges, ctx) — escolhe a faixa mais específica
 *   - isOutOfRange(value, range) — testa se valor está fora dos limites
 *   - classifyLabResult(value, ranges, ctx) — combina os dois + direção
 *
 * Sem IO — caller carrega ranges do banco e passa pra função (testabilidade).
 */

export type Sex = 'male' | 'female' | 'any'

export interface LabReferenceRange {
  id: string
  sex: Sex
  ageMinYears: number | null
  ageMaxYears: number | null
  /** Condição filtro: 'gestante', 'diabetico', 'atleta', etc. NULL = qualquer */
  condition: string | null
  minValue: number | null
  maxValue: number | null
  notes: string | null
}

export interface LabResultContext {
  ageYears: number
  sex: Sex
  /** Condição do paciente (gestante, diabético, etc) */
  condition?: string | null
}

export type OutOfRangeDirection = 'above' | 'below'

export interface LabClassification {
  outOfRange: boolean
  direction: OutOfRangeDirection | null
  referenceRangeIdUsed: string | null
  /** Severidade visual (light/medium/severe) — Sprint 30b refina */
  severity: 'normal' | 'mild' | 'severe'
}

/**
 * Escolhe a faixa mais específica:
 *   1. Match exato de condition (se fornecida)
 *   2. Match exato de sex (não 'any')
 *   3. Match de faixa etária
 *   4. Fallback pra range mais genérica (sex=any, condition=null, age=null)
 *
 * Retorna null se nenhuma range é compatível.
 */
export function matchReferenceRange(
  ranges: LabReferenceRange[],
  ctx: LabResultContext,
): LabReferenceRange | null {
  if (ranges.length === 0) return null

  function score(r: LabReferenceRange): number {
    let s = 0
    // Match de condition prevalece — +1000
    if (ctx.condition && r.condition === ctx.condition) s += 1000
    else if (!ctx.condition && r.condition === null) s += 100
    else if (r.condition !== null) return -1 // rejeita: range com condition que paciente não tem

    // Match exato de sexo +200; 'any' +50
    if (r.sex === ctx.sex) s += 200
    else if (r.sex === 'any') s += 50
    else return -1 // sex específico que não bate

    // Faixa etária: dentro = +100, sem faixa = +20
    if (r.ageMinYears == null && r.ageMaxYears == null) {
      s += 20
    } else {
      const minOk = r.ageMinYears == null || ctx.ageYears >= r.ageMinYears
      const maxOk = r.ageMaxYears == null || ctx.ageYears <= r.ageMaxYears
      if (minOk && maxOk) {
        s += 100
        // Bonus se faixa é mais estreita (menos genérica)
        if (r.ageMinYears != null && r.ageMaxYears != null) {
          const breadth = r.ageMaxYears - r.ageMinYears
          s += Math.max(0, 50 - breadth)
        }
      } else {
        return -1
      }
    }
    return s
  }

  let best: LabReferenceRange | null = null
  let bestScore = -1
  for (const r of ranges) {
    const sc = score(r)
    if (sc > bestScore) {
      best = r
      bestScore = sc
    }
  }
  return best
}

/**
 * Testa se valor está fora dos limites da range. Suporta os 4 casos:
 *   - min só → fora se value < min (below)
 *   - max só → fora se value > max (above)
 *   - min + max → fora se value < min OR value > max
 *   - nenhum → nunca fora (range degenerada — não deve ocorrer com check constraint)
 */
export function isOutOfRange(
  value: number,
  range: Pick<LabReferenceRange, 'minValue' | 'maxValue'>,
): { outOfRange: boolean; direction: OutOfRangeDirection | null } {
  const { minValue, maxValue } = range
  if (minValue == null && maxValue == null) return { outOfRange: false, direction: null }
  if (minValue != null && value < minValue) return { outOfRange: true, direction: 'below' }
  if (maxValue != null && value > maxValue) return { outOfRange: true, direction: 'above' }
  return { outOfRange: false, direction: null }
}

/**
 * Severidade do desvio:
 *   - mild: dentro de 20% do limite
 *   - severe: além de 20% do limite
 */
function classifySeverity(
  value: number,
  range: Pick<LabReferenceRange, 'minValue' | 'maxValue'>,
  direction: OutOfRangeDirection,
): 'mild' | 'severe' {
  const threshold = 0.2 // 20%
  if (direction === 'below' && range.minValue != null) {
    const deviation = (range.minValue - value) / Math.abs(range.minValue || 1)
    return deviation > threshold ? 'severe' : 'mild'
  }
  if (direction === 'above' && range.maxValue != null) {
    const deviation = (value - range.maxValue) / Math.abs(range.maxValue || 1)
    return deviation > threshold ? 'severe' : 'mild'
  }
  return 'mild'
}

/**
 * Combina matchReferenceRange + isOutOfRange + severidade.
 */
export function classifyLabResult(
  value: number,
  ranges: LabReferenceRange[],
  ctx: LabResultContext,
): LabClassification {
  const range = matchReferenceRange(ranges, ctx)
  if (!range) {
    return {
      outOfRange: false,
      direction: null,
      referenceRangeIdUsed: null,
      severity: 'normal',
    }
  }
  const check = isOutOfRange(value, range)
  if (!check.outOfRange) {
    return {
      outOfRange: false,
      direction: null,
      referenceRangeIdUsed: range.id,
      severity: 'normal',
    }
  }
  return {
    outOfRange: true,
    direction: check.direction,
    referenceRangeIdUsed: range.id,
    severity: classifySeverity(value, range, check.direction!),
  }
}

/**
 * Calcula idade em anos a partir de birthDate (ISO date YYYY-MM-DD).
 */
export function ageYearsAt(birthDate: string, atDate: string): number {
  const b = new Date(birthDate)
  const at = new Date(atDate)
  let years = at.getUTCFullYear() - b.getUTCFullYear()
  const monthDiff = at.getUTCMonth() - b.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < b.getUTCDate())) {
    years--
  }
  return years
}
