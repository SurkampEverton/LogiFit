/**
 * Interpretação preliminar de exames — funções puras Sprint 33 (ADR 0050).
 *
 * Caller orquestra:
 *   1. `compareWithRanges(analytes, ranges, ctx)` retorna `outOfRange[]` por
 *      analito vs reference_ranges (Sprint 30)
 *   2. `detectPatterns(outOfRange)` agrega padrões cross-analito (perfil
 *      aterogênico, anemia, etc) baseado em regras curadas
 *   3. LLM gera `hypotheses` + `followUpSuggestions` — passa pelo classifier
 *      (regra 28)
 *
 * Sem IO. Caller carrega ranges do banco e passa pra função.
 */

import type { ExamAnalyteParsed } from './extraction-schema'

// ─── Reference range matching (reusa lib pura nutri/lab — Sprint 30) ───

export interface OutOfRangeItem {
  analyte: ExamAnalyteParsed
  direction: 'above' | 'below'
  /** Severity heurística: 'mild' até 20% além do limite; 'severe' acima */
  severity: 'mild' | 'severe'
  /** Faixa que foi usada na comparação (auditoria) */
  rangeUsed: {
    minValue: number | null
    maxValue: number | null
    sex: string
    condition: string | null
  } | null
}

export interface ReferenceRangeInput {
  /** code do analito (ex: 'glicose_jejum') */
  code: string
  sex: 'male' | 'female' | 'any'
  ageMinYears: number | null
  ageMaxYears: number | null
  condition: string | null
  minValue: number | null
  maxValue: number | null
}

export interface PatientContext {
  ageYears: number
  sex: 'male' | 'female' | 'any'
  condition?: string | null
}

/**
 * Para cada analito extraído, busca a range mais específica e classifica
 * out-of-range. Retorna lista filtrada apenas dos que estão fora.
 */
export function compareWithRanges(
  analytes: ExamAnalyteParsed[],
  ranges: ReferenceRangeInput[],
  ctx: PatientContext,
): OutOfRangeItem[] {
  const rangesByCode = new Map<string, ReferenceRangeInput[]>()
  for (const r of ranges) {
    const arr = rangesByCode.get(r.code) ?? []
    arr.push(r)
    rangesByCode.set(r.code, arr)
  }

  const out: OutOfRangeItem[] = []
  for (const a of analytes) {
    const codeRanges = rangesByCode.get(a.code) ?? []
    if (codeRanges.length === 0) continue
    const best = pickBestRange(codeRanges, ctx)
    if (!best) continue
    const oor = classifyOutOfRange(a.value, best)
    if (!oor) continue
    out.push({
      analyte: a,
      direction: oor.direction,
      severity: oor.severity,
      rangeUsed: {
        minValue: best.minValue,
        maxValue: best.maxValue,
        sex: best.sex,
        condition: best.condition,
      },
    })
  }
  return out
}

function pickBestRange(
  ranges: ReferenceRangeInput[],
  ctx: PatientContext,
): ReferenceRangeInput | null {
  function score(r: ReferenceRangeInput): number {
    let s = 0
    if (ctx.condition && r.condition === ctx.condition) s += 1000
    else if (!ctx.condition && r.condition === null) s += 100
    else if (r.condition !== null) return -1

    if (r.sex === ctx.sex) s += 200
    else if (r.sex === 'any') s += 50
    else return -1

    if (r.ageMinYears == null && r.ageMaxYears == null) {
      s += 20
    } else {
      const minOk = r.ageMinYears == null || ctx.ageYears >= r.ageMinYears
      const maxOk = r.ageMaxYears == null || ctx.ageYears <= r.ageMaxYears
      if (!minOk || !maxOk) return -1
      s += 100
      if (r.ageMinYears != null && r.ageMaxYears != null) {
        const breadth = r.ageMaxYears - r.ageMinYears
        s += Math.max(0, 50 - breadth)
      }
    }
    return s
  }

  let best: ReferenceRangeInput | null = null
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

function classifyOutOfRange(
  value: number,
  range: ReferenceRangeInput,
): { direction: 'above' | 'below'; severity: 'mild' | 'severe' } | null {
  const { minValue, maxValue } = range
  if (minValue == null && maxValue == null) return null
  let direction: 'above' | 'below' | null = null
  let limit: number | null = null
  if (minValue != null && value < minValue) {
    direction = 'below'
    limit = minValue
  } else if (maxValue != null && value > maxValue) {
    direction = 'above'
    limit = maxValue
  }
  if (!direction || limit == null) return null
  const deviation = Math.abs(value - limit) / Math.abs(limit || 1)
  return { direction, severity: deviation > 0.2 ? 'severe' : 'mild' }
}

// ─── Padrões cross-analito (curados) ────────────────────────────────────

export interface PatternDefinition {
  /** Code canônico do padrão */
  code: string
  /** Nome legível */
  label: string
  /** Descrição clínica conservadora ("padrão sugestivo de...") */
  description: string
  /** Required analytes: todos precisam estar out_of_range na direção dada */
  required: Array<{
    code: string
    direction: 'above' | 'below'
  }>
  /** Optional: aumenta confiança se presente */
  optional?: Array<{
    code: string
    direction: 'above' | 'below'
  }>
}

/**
 * Catálogo curado de padrões cross-analito comuns. Sprint 33b expande conforme
 * profissionais sugerem.
 */
export const PATTERN_CATALOG: PatternDefinition[] = [
  {
    code: 'perfil_aterogenico',
    label: 'Perfil aterogênico (risco cardiovascular elevado)',
    description:
      'Padrão sugestivo de risco cardiovascular: LDL elevado + HDL baixo + triglicérides elevados. Avaliar contexto clínico.',
    required: [
      { code: 'ldl', direction: 'above' },
      { code: 'hdl', direction: 'below' },
    ],
    optional: [{ code: 'triglicerides', direction: 'above' }],
  },
  {
    code: 'padrao_anemico_ferropriva',
    label: 'Padrão sugestivo de anemia ferropriva',
    description:
      'Hemoglobina baixa + ferritina baixa sugerem anemia por deficiência de ferro. Investigação adicional recomendada.',
    required: [
      { code: 'hemoglobina', direction: 'below' },
      { code: 'ferritina', direction: 'below' },
    ],
  },
  {
    code: 'resistencia_insulina_inicial',
    label: 'Sinais iniciais de resistência à insulina',
    description:
      'Glicemia de jejum elevada (limítrofe ou pré-diabetes) + HbA1c elevada. Avaliar HOMA-IR e adequação dietética.',
    required: [
      { code: 'glicose_jejum', direction: 'above' },
      { code: 'hba1c', direction: 'above' },
    ],
  },
  {
    code: 'disfuncao_hepatica',
    label: 'Padrão sugestivo de disfunção hepática',
    description: 'AST + ALT elevados sugerem possível inflamação hepática. Investigar causas.',
    required: [
      { code: 'ast_tgo', direction: 'above' },
      { code: 'alt_tgp', direction: 'above' },
    ],
  },
  {
    code: 'hipotireoidismo_sugestivo',
    label: 'Padrão sugestivo de hipotireoidismo',
    description: 'TSH elevado + T4 livre baixo. Confirmar com novo exame em 4-6 semanas + clínica.',
    required: [
      { code: 'tsh', direction: 'above' },
      { code: 't4_livre', direction: 'below' },
    ],
  },
  {
    code: 'deficiencia_vitamina_d',
    label: 'Deficiência de vitamina D',
    description: 'Vitamina D 25-OH abaixo de 30 ng/mL. Avaliar suplementação.',
    required: [{ code: 'vitamina_d_25oh', direction: 'below' }],
  },
  {
    code: 'deficiencia_b12',
    label: 'Deficiência de vitamina B12',
    description:
      'B12 abaixo de 200 pg/mL. Comum em veganos, idosos, pacientes com gastrite atrófica ou usuários de metformina/IBP.',
    required: [{ code: 'vitamina_b12', direction: 'below' }],
  },
]

export interface DetectedPattern {
  code: string
  label: string
  description: string
  confidence: number
  evidence: string[] // codes dos analitos que casaram
}

/**
 * Cruza out_of_range com catálogo de padrões. Confidence = 1 se todos os
 * required matcharam; +0.1 por optional matcheado (capped em 1).
 */
export function detectPatterns(outOfRange: OutOfRangeItem[]): DetectedPattern[] {
  const byCode = new Map<string, OutOfRangeItem>()
  for (const o of outOfRange) {
    byCode.set(o.analyte.code, o)
  }

  const detected: DetectedPattern[] = []
  for (const p of PATTERN_CATALOG) {
    const requiredMet = p.required.every((req) => {
      const item = byCode.get(req.code)
      return item != null && item.direction === req.direction
    })
    if (!requiredMet) continue

    const optionalMatches = (p.optional ?? []).filter((opt) => {
      const item = byCode.get(opt.code)
      return item != null && item.direction === opt.direction
    })

    const evidence = [...p.required.map((r) => r.code), ...optionalMatches.map((o) => o.code)]
    const confidence = Math.min(1, 0.85 + 0.1 * optionalMatches.length)

    detected.push({
      code: p.code,
      label: p.label,
      description: p.description,
      confidence: Math.round(confidence * 100) / 100,
      evidence,
    })
  }

  return detected
}

// ─── Follow-up suggestions (curadas) ────────────────────────────────────

/**
 * Sugestões de follow-up por padrão detectado. Conservador — apenas indica
 * exames que poderiam esclarecer; profissional decide.
 */
const FOLLOW_UP_BY_PATTERN: Record<string, string[]> = {
  perfil_aterogenico: [
    'Apolipoproteína B (apoB)',
    'Lipoproteína(a) [Lp(a)]',
    'PCR ultrassensível',
    'Glicemia de jejum + HbA1c (se ainda não medidos)',
  ],
  padrao_anemico_ferropriva: [
    'Ferro sérico + saturação de transferrina',
    'Vitamina B12 + ácido fólico (se ainda não medidos)',
    'Pesquisa de sangue oculto nas fezes (se causa não óbvia)',
  ],
  resistencia_insulina_inicial: [
    'Insulina de jejum + HOMA-IR',
    'Teste de tolerância oral à glicose (TOTG)',
    'Perfil lipídico completo (se ainda não medido)',
  ],
  disfuncao_hepatica: [
    'GGT + fosfatase alcalina',
    'Sorologias para hepatites virais (HBsAg, anti-HCV)',
    'USG abdome superior',
  ],
  hipotireoidismo_sugestivo: [
    'Repetir TSH + T4 livre em 4-6 semanas',
    'Anti-TPO (autoimunidade tireoidiana)',
  ],
  deficiencia_vitamina_d: ['PTH (paratormônio)', 'Cálcio sérico + fósforo'],
  deficiencia_b12: ['Ácido fólico', 'Homocisteína', 'Ácido metilmalônico (MMA)'],
}

export function getFollowUpSuggestions(patterns: DetectedPattern[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const p of patterns) {
    const sugs = FOLLOW_UP_BY_PATTERN[p.code] ?? []
    for (const s of sugs) {
      if (!seen.has(s)) {
        seen.add(s)
        result.push(s)
      }
    }
  }
  return result
}
