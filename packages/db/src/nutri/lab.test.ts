/**
 * lab.ts — unit tests Sprint 30 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  ageYearsAt,
  classifyLabResult,
  isOutOfRange,
  matchReferenceRange,
  type LabReferenceRange,
} from './lab'

function range(over: Partial<LabReferenceRange>): LabReferenceRange {
  return {
    id: 'r-test',
    sex: 'any',
    ageMinYears: null,
    ageMaxYears: null,
    condition: null,
    minValue: null,
    maxValue: null,
    notes: null,
    ...over,
  }
}

describe('isOutOfRange', () => {
  it('valor dentro do range → false', () => {
    const r = isOutOfRange(95, { minValue: 70, maxValue: 99 })
    expect(r.outOfRange).toBe(false)
    expect(r.direction).toBeNull()
  })

  it('valor acima do max → above', () => {
    const r = isOutOfRange(120, { minValue: 70, maxValue: 99 })
    expect(r.outOfRange).toBe(true)
    expect(r.direction).toBe('above')
  })

  it('valor abaixo do min → below', () => {
    const r = isOutOfRange(60, { minValue: 70, maxValue: 99 })
    expect(r.outOfRange).toBe(true)
    expect(r.direction).toBe('below')
  })

  it('só max — abaixo OK', () => {
    const r = isOutOfRange(50, { minValue: null, maxValue: 100 })
    expect(r.outOfRange).toBe(false)
  })

  it('só max — acima → above', () => {
    const r = isOutOfRange(150, { minValue: null, maxValue: 100 })
    expect(r.outOfRange).toBe(true)
    expect(r.direction).toBe('above')
  })

  it('só min — abaixo → below', () => {
    const r = isOutOfRange(15, { minValue: 30, maxValue: null })
    expect(r.outOfRange).toBe(true)
    expect(r.direction).toBe('below')
  })

  it('só min — acima OK', () => {
    const r = isOutOfRange(45, { minValue: 30, maxValue: null })
    expect(r.outOfRange).toBe(false)
  })

  it('ambos null → nunca fora', () => {
    const r = isOutOfRange(100, { minValue: null, maxValue: null })
    expect(r.outOfRange).toBe(false)
  })
})

describe('matchReferenceRange', () => {
  it('escolhe range com condition match (gestante)', () => {
    const ranges = [
      range({ id: 'g', condition: 'gestante', sex: 'female', minValue: 65, maxValue: 95 }),
      range({ id: 'd', sex: 'any', minValue: 70, maxValue: 99 }),
    ]
    const r = matchReferenceRange(ranges, { ageYears: 32, sex: 'female', condition: 'gestante' })
    expect(r?.id).toBe('g')
  })

  it('sem condition usa range default', () => {
    const ranges = [
      range({ id: 'g', condition: 'gestante', sex: 'female', minValue: 65 }),
      range({ id: 'd', sex: 'any', minValue: 70 }),
    ]
    const r = matchReferenceRange(ranges, { ageYears: 32, sex: 'female' })
    expect(r?.id).toBe('d')
  })

  it('rejeita range com condition que paciente não tem', () => {
    const ranges = [range({ id: 'g', condition: 'gestante', sex: 'female', minValue: 65 })]
    const r = matchReferenceRange(ranges, { ageYears: 32, sex: 'female' })
    expect(r).toBeNull()
  })

  it('escolhe range mais estreita em faixa etária', () => {
    const ranges = [
      range({ id: 'amplo', ageMinYears: 18, ageMaxYears: 80, minValue: 70 }),
      range({ id: 'estreito', ageMinYears: 30, ageMaxYears: 40, minValue: 72 }),
    ]
    const r = matchReferenceRange(ranges, { ageYears: 35, sex: 'male' })
    expect(r?.id).toBe('estreito')
  })

  it('rejeita range fora da faixa etária', () => {
    const ranges = [range({ id: 'idoso', ageMinYears: 65, ageMaxYears: 100, minValue: 70 })]
    const r = matchReferenceRange(ranges, { ageYears: 30, sex: 'male' })
    expect(r).toBeNull()
  })

  it('match exato de sexo > sex=any', () => {
    const ranges = [
      range({ id: 'any', sex: 'any', minValue: 70 }),
      range({ id: 'male', sex: 'male', minValue: 75 }),
    ]
    const r = matchReferenceRange(ranges, { ageYears: 30, sex: 'male' })
    expect(r?.id).toBe('male')
  })

  it('lista vazia retorna null', () => {
    const r = matchReferenceRange([], { ageYears: 30, sex: 'male' })
    expect(r).toBeNull()
  })
})

describe('classifyLabResult', () => {
  const baseRanges: LabReferenceRange[] = [
    range({ id: 'glicose-default', sex: 'any', minValue: 70, maxValue: 99 }),
  ]

  it('valor normal → not out of range + severity normal', () => {
    const r = classifyLabResult(85, baseRanges, { ageYears: 30, sex: 'male' })
    expect(r.outOfRange).toBe(false)
    expect(r.severity).toBe('normal')
    expect(r.referenceRangeIdUsed).toBe('glicose-default')
  })

  it('valor um pouco acima → mild severity', () => {
    const r = classifyLabResult(110, baseRanges, { ageYears: 30, sex: 'male' })
    expect(r.outOfRange).toBe(true)
    expect(r.direction).toBe('above')
    // (110 - 99) / 99 = 0.111 (< 0.20) → mild
    expect(r.severity).toBe('mild')
  })

  it('valor muito acima → severe', () => {
    const r = classifyLabResult(180, baseRanges, { ageYears: 30, sex: 'male' })
    expect(r.outOfRange).toBe(true)
    expect(r.direction).toBe('above')
    // (180 - 99) / 99 = 0.818 (>> 0.20) → severe
    expect(r.severity).toBe('severe')
  })

  it('valor abaixo do min → below', () => {
    const r = classifyLabResult(55, baseRanges, { ageYears: 30, sex: 'male' })
    expect(r.outOfRange).toBe(true)
    expect(r.direction).toBe('below')
    // (70 - 55) / 70 = 0.214 → severe (>20%)
    expect(r.severity).toBe('severe')
  })

  it('nenhuma range compatível → normal sem referência', () => {
    const ranges: LabReferenceRange[] = [
      range({ id: 'gestante', condition: 'gestante', sex: 'female', minValue: 65 }),
    ]
    const r = classifyLabResult(85, ranges, { ageYears: 30, sex: 'male' })
    expect(r.outOfRange).toBe(false)
    expect(r.referenceRangeIdUsed).toBeNull()
    expect(r.severity).toBe('normal')
  })
})

describe('ageYearsAt', () => {
  it('idade completa', () => {
    expect(ageYearsAt('1990-05-15', '2026-05-18')).toBe(36)
  })

  it('idade incompleta (aniversário ainda não chegou)', () => {
    expect(ageYearsAt('1990-12-25', '2026-05-18')).toBe(35)
  })

  it('mesmo dia do aniversário', () => {
    expect(ageYearsAt('2000-05-18', '2026-05-18')).toBe(26)
  })
})
