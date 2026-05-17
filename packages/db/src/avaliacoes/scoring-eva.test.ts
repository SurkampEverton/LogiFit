import { describe, expect, it } from 'vitest'
import { scoreEva } from './scoring-eva'

describe('scoreEva', () => {
  it('0 → sem_dor info', () => {
    const r = scoreEva({ value: 0 })!
    expect(r.total).toBe(0)
    expect(r.interpretation.label).toBe('sem_dor')
    expect(r.interpretation.severity).toBe('info')
  })

  it('2 → dor_leve', () => {
    const r = scoreEva({ value: 2 })!
    expect(r.interpretation.label).toBe('dor_leve')
    expect(r.interpretation.severity).toBe('info')
  })

  it('5 → dor_moderada warning', () => {
    const r = scoreEva({ value: 5 })!
    expect(r.interpretation.label).toBe('dor_moderada')
    expect(r.interpretation.severity).toBe('warning')
  })

  it('8 → dor_intensa danger', () => {
    const r = scoreEva({ value: 8 })!
    expect(r.interpretation.label).toBe('dor_intensa')
    expect(r.interpretation.severity).toBe('danger')
  })

  it('10 → dor_insuportavel critical', () => {
    const r = scoreEva({ value: 10 })!
    expect(r.interpretation.label).toBe('dor_insuportavel')
    expect(r.interpretation.severity).toBe('critical')
  })

  it('11 retorna null (fora range)', () => {
    expect(scoreEva({ value: 11 })).toBeNull()
  })

  it('-1 retorna null', () => {
    expect(scoreEva({ value: -1 })).toBeNull()
  })

  it('2.5 retorna null (não inteiro)', () => {
    expect(scoreEva({ value: 2.5 })).toBeNull()
  })
})
