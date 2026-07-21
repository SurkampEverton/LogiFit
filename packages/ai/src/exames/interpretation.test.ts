/**
 * Interpretation comparator + pattern detector — unit tests Sprint 33 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import type { ExamAnalyteParsed } from './extraction-schema'
import {
  type PatientContext,
  type ReferenceRangeInput,
  compareWithRanges,
  detectPatterns,
  getFollowUpSuggestions,
} from './interpretation'

function analyte(
  over: Partial<ExamAnalyteParsed> & { code: string; value: number },
): ExamAnalyteParsed {
  return {
    code: over.code,
    label: over.code,
    value: over.value,
    unit: over.unit ?? 'mg/dL',
    referenceHint: null,
    labAnalyteIdMatch: null,
    matchConfidence: null,
  }
}

function range(over: Partial<ReferenceRangeInput> & { code: string }): ReferenceRangeInput {
  return {
    sex: 'any',
    ageMinYears: null,
    ageMaxYears: null,
    condition: null,
    minValue: null,
    maxValue: null,
    ...over,
  }
}

const adultMale: PatientContext = { ageYears: 40, sex: 'male' }
const adultFemale: PatientContext = { ageYears: 35, sex: 'female' }

describe('compareWithRanges', () => {
  it('valor dentro da faixa → vazio', () => {
    const r = compareWithRanges(
      [analyte({ code: 'glicose_jejum', value: 85 })],
      [range({ code: 'glicose_jejum', minValue: 70, maxValue: 99 })],
      adultMale,
    )
    expect(r).toHaveLength(0)
  })

  it('valor acima → out_of_range above', () => {
    const r = compareWithRanges(
      [analyte({ code: 'glicose_jejum', value: 115 })],
      [range({ code: 'glicose_jejum', minValue: 70, maxValue: 99 })],
      adultMale,
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.direction).toBe('above')
    // 115 vs 99 = 16% > 0% mas <= 20% → mild
    expect(r[0]!.severity).toBe('mild')
  })

  it('valor muito acima → severe', () => {
    const r = compareWithRanges(
      [analyte({ code: 'glicose_jejum', value: 200 })],
      [range({ code: 'glicose_jejum', minValue: 70, maxValue: 99 })],
      adultMale,
    )
    expect(r[0]!.severity).toBe('severe')
  })

  it('valor abaixo → out_of_range below', () => {
    const r = compareWithRanges(
      [analyte({ code: 'hb', value: 10.5 })],
      [range({ code: 'hb', minValue: 13.5, maxValue: 17.5 })],
      adultMale,
    )
    expect(r[0]!.direction).toBe('below')
    expect(r[0]!.severity).toBe('severe') // 22% abaixo
  })

  it('escolhe range com sex match', () => {
    const r = compareWithRanges(
      [analyte({ code: 'hb', value: 12.5 })],
      [
        range({ code: 'hb', sex: 'male', minValue: 13.5, maxValue: 17.5 }),
        range({ code: 'hb', sex: 'female', minValue: 12.0, maxValue: 15.5 }),
      ],
      adultFemale,
    )
    expect(r).toHaveLength(0) // 12.5 está dentro da faixa female (12-15.5)
  })

  it('match exact sex prevalece sobre any', () => {
    const r = compareWithRanges(
      [analyte({ code: 'hb', value: 13.0 })],
      [
        range({ code: 'hb', sex: 'any', minValue: 11.0, maxValue: 16.0 }),
        range({ code: 'hb', sex: 'male', minValue: 13.5, maxValue: 17.5 }),
      ],
      adultMale,
    )
    expect(r).toHaveLength(1) // male range = 13.5, 13.0 está abaixo
  })

  it('analito sem range no banco é ignorado', () => {
    const r = compareWithRanges(
      [analyte({ code: 'glicose_jejum', value: 150 })],
      [range({ code: 'colesterol', minValue: 0, maxValue: 200 })],
      adultMale,
    )
    expect(r).toHaveLength(0)
  })

  it('condition gestante prevalece', () => {
    const r = compareWithRanges(
      [analyte({ code: 'glicose_jejum', value: 95 })],
      [
        range({ code: 'glicose_jejum', minValue: 70, maxValue: 99 }),
        range({
          code: 'glicose_jejum',
          condition: 'gestante',
          sex: 'female',
          minValue: 70,
          maxValue: 92,
        }),
      ],
      { ageYears: 30, sex: 'female', condition: 'gestante' },
    )
    expect(r).toHaveLength(1) // 95 > 92 (gestante)
  })
})

describe('detectPatterns', () => {
  it('perfil aterogênico detectado quando LDL alto + HDL baixo', () => {
    const out = [
      {
        analyte: analyte({ code: 'ldl', value: 160 }),
        direction: 'above' as const,
        severity: 'mild' as const,
        rangeUsed: null,
      },
      {
        analyte: analyte({ code: 'hdl', value: 35 }),
        direction: 'below' as const,
        severity: 'mild' as const,
        rangeUsed: null,
      },
    ]
    const patterns = detectPatterns(out)
    expect(patterns.find((p) => p.code === 'perfil_aterogenico')).toBeTruthy()
  })

  it('perfil aterogênico com triglicérides altos → confidence maior', () => {
    const out = [
      {
        analyte: analyte({ code: 'ldl', value: 160 }),
        direction: 'above' as const,
        severity: 'mild' as const,
        rangeUsed: null,
      },
      {
        analyte: analyte({ code: 'hdl', value: 35 }),
        direction: 'below' as const,
        severity: 'mild' as const,
        rangeUsed: null,
      },
      {
        analyte: analyte({ code: 'triglicerides', value: 220 }),
        direction: 'above' as const,
        severity: 'mild' as const,
        rangeUsed: null,
      },
    ]
    const patterns = detectPatterns(out)
    const p = patterns.find((x) => x.code === 'perfil_aterogenico')!
    expect(p.confidence).toBeGreaterThan(0.9)
    expect(p.evidence).toContain('triglicerides')
  })

  it('hipotireoidismo sugestivo: TSH alto + T4L baixo', () => {
    const out = [
      {
        analyte: analyte({ code: 'tsh', value: 8 }),
        direction: 'above' as const,
        severity: 'mild' as const,
        rangeUsed: null,
      },
      {
        analyte: analyte({ code: 't4_livre', value: 0.5 }),
        direction: 'below' as const,
        severity: 'mild' as const,
        rangeUsed: null,
      },
    ]
    const patterns = detectPatterns(out)
    expect(patterns.some((p) => p.code === 'hipotireoidismo_sugestivo')).toBe(true)
  })

  it('deficiência vitamina D detectada', () => {
    const out = [
      {
        analyte: analyte({ code: 'vitamina_d_25oh', value: 22, unit: 'ng/mL' }),
        direction: 'below' as const,
        severity: 'mild' as const,
        rangeUsed: null,
      },
    ]
    const patterns = detectPatterns(out)
    expect(patterns.find((p) => p.code === 'deficiencia_vitamina_d')).toBeTruthy()
  })

  it('só 1 dos required não cria padrão', () => {
    const out = [
      {
        analyte: analyte({ code: 'ldl', value: 160 }),
        direction: 'above' as const,
        severity: 'mild' as const,
        rangeUsed: null,
      },
      // HDL não está fora
    ]
    const patterns = detectPatterns(out)
    expect(patterns.find((p) => p.code === 'perfil_aterogenico')).toBeFalsy()
  })

  it('direção contrária ao esperado não conta', () => {
    const out = [
      {
        analyte: analyte({ code: 'tsh', value: 0.1 }),
        direction: 'below' as const, // hipertireoidismo, não hipo
        severity: 'mild' as const,
        rangeUsed: null,
      },
      {
        analyte: analyte({ code: 't4_livre', value: 0.5 }),
        direction: 'below' as const,
        severity: 'mild' as const,
        rangeUsed: null,
      },
    ]
    const patterns = detectPatterns(out)
    expect(patterns.find((p) => p.code === 'hipotireoidismo_sugestivo')).toBeFalsy()
  })
})

describe('getFollowUpSuggestions', () => {
  it('agrega + deduplica sugestões', () => {
    const sugs = getFollowUpSuggestions([
      {
        code: 'perfil_aterogenico',
        label: 'X',
        description: '',
        confidence: 0.9,
        evidence: [],
      },
      {
        code: 'resistencia_insulina_inicial',
        label: 'Y',
        description: '',
        confidence: 0.85,
        evidence: [],
      },
    ])
    expect(sugs.length).toBeGreaterThan(0)
    // Perfil lipídico aparece em ambos → dedup
    const lipidico = sugs.filter((s) => s.toLowerCase().includes('lipídico'))
    expect(lipidico.length).toBe(1)
  })

  it('padrão desconhecido retorna vazio', () => {
    const sugs = getFollowUpSuggestions([
      { code: 'pattern_inexistente', label: 'X', description: '', confidence: 1, evidence: [] },
    ])
    expect(sugs).toEqual([])
  })

  it('lista vazia retorna vazia', () => {
    expect(getFollowUpSuggestions([])).toEqual([])
  })
})
