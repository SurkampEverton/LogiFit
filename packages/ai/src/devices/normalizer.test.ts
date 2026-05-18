/**
 * Device Hub normalizer + inbody parser — unit tests Sprint 32 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import { parseInBodyCsv } from './inbody-parser'
import {
  aggregateDailySummaries,
  detectOutliers,
  partitionValidReadings,
  validateReading,
} from './normalizer'
import type { NormalizedReading } from './provider'

describe('validateReading', () => {
  it('HR dentro da faixa OK', () => {
    const r = validateReading({
      observationCode: 'HR',
      value: 75,
      unit: 'bpm',
      measuredAt: '2026-05-18T10:00:00Z',
    })
    expect(r.valid).toBe(true)
  })

  it('HR abaixo de 30 → out_of_range', () => {
    const r = validateReading({
      observationCode: 'HR',
      value: 20,
      unit: 'bpm',
      measuredAt: '2026-05-18T10:00:00Z',
    })
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('out_of_range')
  })

  it('WEIGHT acima de 300kg → out_of_range', () => {
    const r = validateReading({
      observationCode: 'WEIGHT',
      value: 400,
      unit: 'kg',
      measuredAt: '2026-05-18T10:00:00Z',
    })
    expect(r.valid).toBe(false)
  })

  it('unit_mismatch quando lbs em vez de kg', () => {
    const r = validateReading({
      observationCode: 'WEIGHT',
      value: 165,
      unit: 'lbs',
      measuredAt: '2026-05-18T10:00:00Z',
    })
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('unit_mismatch')
  })

  it('código desconhecido → unknown_code', () => {
    const r = validateReading({
      observationCode: 'TEMPERATURE_C',
      value: 36.5,
      unit: 'C',
      measuredAt: '2026-05-18T10:00:00Z',
    })
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('unknown_code')
  })
})

describe('partitionValidReadings', () => {
  it('separa válidos de inválidos', () => {
    const r = partitionValidReadings([
      {
        observationCode: 'HR_RESTING',
        value: 60,
        unit: 'bpm',
        measuredAt: '2026-05-18T07:00:00Z',
      },
      {
        observationCode: 'WEIGHT',
        value: 500, // fora da faixa
        unit: 'kg',
        measuredAt: '2026-05-18T07:00:00Z',
      },
      {
        observationCode: 'UNKNOWN',
        value: 1,
        unit: 'x',
        measuredAt: '2026-05-18T07:00:00Z',
      },
    ])
    expect(r.valid).toHaveLength(1)
    expect(r.invalid).toHaveLength(2)
    expect(r.invalid[0]!.reason).toBe('out_of_range')
    expect(r.invalid[1]!.reason).toBe('unknown_code')
  })
})

describe('aggregateDailySummaries', () => {
  it('agrupa por código + data', () => {
    const readings: NormalizedReading[] = [
      { observationCode: 'HR_RESTING', value: 60, unit: 'bpm', measuredAt: '2026-05-18T07:00:00Z' },
      { observationCode: 'HR_RESTING', value: 65, unit: 'bpm', measuredAt: '2026-05-18T08:00:00Z' },
      { observationCode: 'HR_RESTING', value: 70, unit: 'bpm', measuredAt: '2026-05-18T09:00:00Z' },
      { observationCode: 'HR_RESTING', value: 58, unit: 'bpm', measuredAt: '2026-05-19T07:00:00Z' },
      { observationCode: 'STEPS', value: 8000, unit: 'steps', measuredAt: '2026-05-18T22:00:00Z' },
    ]
    const agg = aggregateDailySummaries(readings)
    expect(agg).toHaveLength(3)

    const hrDay1 = agg.find((a) => a.observationCode === 'HR_RESTING' && a.observedDate === '2026-05-18')!
    expect(hrDay1.minValue).toBe(60)
    expect(hrDay1.maxValue).toBe(70)
    expect(hrDay1.avgValue).toBe(65)
    expect(hrDay1.samplesCount).toBe(3)

    const hrDay2 = agg.find((a) => a.observationCode === 'HR_RESTING' && a.observedDate === '2026-05-19')!
    expect(hrDay2.samplesCount).toBe(1)
    expect(hrDay2.avgValue).toBe(58)

    const steps = agg.find((a) => a.observationCode === 'STEPS')!
    expect(steps.maxValue).toBe(8000)
  })

  it('lista vazia retorna vazia', () => {
    expect(aggregateDailySummaries([])).toEqual([])
  })
})

describe('detectOutliers', () => {
  it('detecta valor >3σ acima da média', () => {
    // Baseline: HR_RESTING ~60bpm ±5
    const baseline = [58, 60, 62, 59, 61, 60, 63, 58, 60, 62]
    const newReadings: NormalizedReading[] = [
      { observationCode: 'HR_RESTING', value: 60, unit: 'bpm', measuredAt: '2026-05-18T07:00:00Z' },
      { observationCode: 'HR_RESTING', value: 95, unit: 'bpm', measuredAt: '2026-05-18T08:00:00Z' }, // outlier
    ]
    const outliers = detectOutliers(newReadings, baseline)
    expect(outliers).toHaveLength(1)
    expect(outliers[0]!.reading.value).toBe(95)
    expect(outliers[0]!.zScore).toBeGreaterThan(3)
  })

  it('baseline pequeno → só valida faixa', () => {
    const newReadings: NormalizedReading[] = [
      { observationCode: 'HR', value: 250, unit: 'bpm', measuredAt: '2026-05-18T07:00:00Z' },
    ]
    const outliers = detectOutliers(newReadings, [60, 65, 70])
    expect(outliers).toHaveLength(1)
    expect(outliers[0]!.reason).toBe('physiologically_impossible')
  })

  it('std=0 retorna sem outliers', () => {
    const outliers = detectOutliers(
      [{ observationCode: 'HR', value: 75, unit: 'bpm', measuredAt: '2026-05-18T07:00:00Z' }],
      [60, 60, 60, 60, 60],
    )
    expect(outliers).toHaveLength(0)
  })
})

describe('parseInBodyCsv', () => {
  it('parse CSV InBody básico (formato US)', () => {
    const csv = `Date,Time,Weight,BodyFatPct,MuscleMass
2026-05-15,08:00:00,80.5,22.3,33.2
2026-05-18,08:30:00,79.8,21.9,33.5`
    const r = parseInBodyCsv(csv)
    expect(r.errors).toHaveLength(0)
    expect(r.readings).toHaveLength(6) // 3 metrics × 2 rows
    const weights = r.readings.filter((x) => x.observationCode === 'WEIGHT')
    expect(weights).toHaveLength(2)
    expect(weights[0]!.value).toBe(80.5)
    expect(weights[0]!.unit).toBe('kg')
  })

  it('parse CSV com formato BR (dd/mm/yyyy + ; separator)', () => {
    const csv = `Data;Hora;Peso (kg);Gordura Corporal (%);Massa Muscular (kg)
15/05/2026;08:00;80,5;22,3;33,2`
    const r = parseInBodyCsv(csv)
    expect(r.errors).toHaveLength(0)
    expect(r.readings.length).toBeGreaterThan(0)
    const weight = r.readings.find((x) => x.observationCode === 'WEIGHT')
    expect(weight?.value).toBe(80.5)
  })

  it('CSV vazio → erro', () => {
    const r = parseInBodyCsv('')
    expect(r.errors).toHaveLength(1)
    expect(r.readings).toHaveLength(0)
  })

  it('sem coluna Date → erro', () => {
    const r = parseInBodyCsv(`Weight,BodyFatPct\n80.5,22.3`)
    expect(r.errors[0]!.reason).toContain('Date')
  })

  it('data inválida pulada com erro', () => {
    const csv = `Date,Weight\nabc,80\n2026-05-18,79`
    const r = parseInBodyCsv(csv)
    expect(r.readings).toHaveLength(1)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('ignora colunas desconhecidas', () => {
    const csv = `Date,Weight,RandomColumn\n2026-05-18,80,xyz`
    const r = parseInBodyCsv(csv)
    expect(r.readings).toHaveLength(1)
    expect(r.readings[0]!.observationCode).toBe('WEIGHT')
  })
})
