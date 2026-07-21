/**
 * Nutri-Agent pattern detector + suggestion generator — unit tests Sprint 34 B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  detectRiskPatterns,
  generatePreConsultSummary,
  generateSuggestionsFromPatterns,
} from './index'
import type { MemberContextSnapshot } from './types'

function makeSnapshot(over: Partial<MemberContextSnapshot> = {}): MemberContextSnapshot {
  return {
    memberId: '00000000-0000-0000-0000-000000000001',
    capturedAt: '2026-05-18T10:00:00Z',
    demographics: { ageYears: 35, sex: 'male' },
    mealPlan: null,
    diaryLast14d: [],
    workoutLoad: null,
    fisioActiveCids: [],
    labResultsRecent: [],
    deviceSummary: {},
    consentsUsed: [],
    ...over,
  }
}

describe('detectRiskPatterns — extreme caloric deficit', () => {
  it('detecta déficit extremo quando avg < 50% target', () => {
    const snap = makeSnapshot({
      mealPlan: {
        id: 'p1',
        name: 'Test',
        goal: 'emagrecimento',
        targetKcal: 2000,
        targetProteinG: 120,
        targetCarbG: 200,
        targetLipidG: 60,
        version: 1,
      },
      diaryLast14d: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-05-${(18 - i).toString().padStart(2, '0')}`,
        totalKcal: 900,
        totalProteinG: 50,
        totalCarbG: 80,
        totalFatG: 30,
        mealsCount: 3,
        adherencePct: 40,
      })),
    })
    const patterns = detectRiskPatterns(snap)
    const p = patterns.find((x) => x.code === 'deficit_calorico_extremo')
    expect(p).toBeTruthy()
    expect(p?.severity).toBe('critical')
  })

  it('attention quando avg entre 50% e 70%', () => {
    const snap = makeSnapshot({
      mealPlan: {
        id: 'p1',
        name: 'Test',
        goal: 'emagrecimento',
        targetKcal: 2000,
        targetProteinG: null,
        targetCarbG: null,
        targetLipidG: null,
        version: 1,
      },
      diaryLast14d: Array.from({ length: 7 }, () => ({
        date: '2026-05-15',
        totalKcal: 1200,
        totalProteinG: 80,
        totalCarbG: 120,
        totalFatG: 40,
        mealsCount: 4,
        adherencePct: 60,
      })),
    })
    const patterns = detectRiskPatterns(snap)
    const p = patterns.find((x) => x.code === 'deficit_calorico_extremo')
    expect(p?.severity).toBe('attention')
  })

  it('não dispara quando ratio >= 0.7', () => {
    const snap = makeSnapshot({
      mealPlan: {
        id: 'p1',
        name: 'Test',
        goal: 'manutencao',
        targetKcal: 2000,
        targetProteinG: null,
        targetCarbG: null,
        targetLipidG: null,
        version: 1,
      },
      diaryLast14d: Array.from({ length: 7 }, () => ({
        date: '2026-05-15',
        totalKcal: 1900,
        totalProteinG: 100,
        totalCarbG: 200,
        totalFatG: 60,
        mealsCount: 5,
        adherencePct: 95,
      })),
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'deficit_calorico_extremo')).toBeFalsy()
  })

  it('não dispara sem mealPlan', () => {
    const snap = makeSnapshot({
      mealPlan: null,
      diaryLast14d: Array.from({ length: 7 }, () => ({
        date: '2026-05-15',
        totalKcal: 500,
        totalProteinG: 0,
        totalCarbG: 0,
        totalFatG: 0,
        mealsCount: 1,
        adherencePct: null,
      })),
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'deficit_calorico_extremo')).toBeFalsy()
  })
})

describe('detectRiskPatterns — aderência baixa', () => {
  it('detecta quando adherence < 50% media 7d', () => {
    const snap = makeSnapshot({
      mealPlan: {
        id: 'p1',
        name: 'Test',
        goal: 'manutencao',
        targetKcal: 2000,
        targetProteinG: null,
        targetCarbG: null,
        targetLipidG: null,
        version: 1,
      },
      diaryLast14d: Array.from({ length: 7 }, () => ({
        date: '2026-05-15',
        totalKcal: 1500,
        totalProteinG: 0,
        totalCarbG: 0,
        totalFatG: 0,
        mealsCount: 3,
        adherencePct: 30,
      })),
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'aderencia_baixa')).toBeTruthy()
  })

  it('ignora quando <4 dias com adherence', () => {
    const snap = makeSnapshot({
      diaryLast14d: Array.from({ length: 3 }, () => ({
        date: '2026-05-15',
        totalKcal: 1500,
        totalProteinG: 0,
        totalCarbG: 0,
        totalFatG: 0,
        mealsCount: 3,
        adherencePct: 10,
      })),
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'aderencia_baixa')).toBeFalsy()
  })
})

describe('detectRiskPatterns — overtraining sugestivo', () => {
  it('detecta HR alto + sono baixo', () => {
    const snap = makeSnapshot({
      deviceSummary: { restingHrAvg7d: 80, sleepAvg7d: 340 },
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'overtraining_sugestivo')).toBeTruthy()
  })

  it('ignora se só HR alto', () => {
    const snap = makeSnapshot({
      deviceSummary: { restingHrAvg7d: 80, sleepAvg7d: 480 },
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'overtraining_sugestivo')).toBeFalsy()
  })

  it('ignora sem device data', () => {
    const snap = makeSnapshot({ deviceSummary: {} })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'overtraining_sugestivo')).toBeFalsy()
  })
})

describe('detectRiskPatterns — risco cardiovascular', () => {
  it('detecta LDL alto + HDL baixo', () => {
    const snap = makeSnapshot({
      labResultsRecent: [
        {
          analyteCode: 'ldl',
          analyteName: 'LDL',
          value: 160,
          unit: 'mg/dL',
          outOfRange: true,
          direction: 'above',
          collectedAt: '2026-05-10T00:00:00Z',
        },
        {
          analyteCode: 'hdl',
          analyteName: 'HDL',
          value: 35,
          unit: 'mg/dL',
          outOfRange: true,
          direction: 'below',
          collectedAt: '2026-05-10T00:00:00Z',
        },
      ],
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'risco_cardiovascular_lipidico')).toBeTruthy()
  })

  it('ignora só LDL', () => {
    const snap = makeSnapshot({
      labResultsRecent: [
        {
          analyteCode: 'ldl',
          analyteName: 'LDL',
          value: 160,
          unit: 'mg/dL',
          outOfRange: true,
          direction: 'above',
          collectedAt: '2026-05-10T00:00:00Z',
        },
      ],
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'risco_cardiovascular_lipidico')).toBeFalsy()
  })
})

describe('detectRiskPatterns — perda peso rápida', () => {
  it('detecta trend < -6 kg/mês', () => {
    const snap = makeSnapshot({
      demographics: { ageYears: 30, sex: 'female', weightTrendKgPerMonth: -7 },
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'perda_peso_rapida')).toBeTruthy()
  })

  it('ignora trend de manutenção', () => {
    const snap = makeSnapshot({
      demographics: { ageYears: 30, sex: 'female', weightTrendKgPerMonth: -2 },
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.find((x) => x.code === 'perda_peso_rapida')).toBeFalsy()
  })
})

describe('detectRiskPatterns — ordering', () => {
  it('ordena por severidade critical → attention → info', () => {
    const snap = makeSnapshot({
      mealPlan: {
        id: 'p1',
        name: 'Test',
        goal: 'manutencao',
        targetKcal: 2000,
        targetProteinG: null,
        targetCarbG: null,
        targetLipidG: null,
        version: 1,
      },
      diaryLast14d: Array.from({ length: 7 }, () => ({
        date: '2026-05-15',
        totalKcal: 800, // 40% — critical
        totalProteinG: 0,
        totalCarbG: 0,
        totalFatG: 0,
        mealsCount: 3,
        adherencePct: 40,
      })),
      fisioActiveCids: [
        { cidCode: 'MG30.0', description: 'Lombalgia', consultaSignedAt: '2026-05-01' },
      ],
      workoutLoad: { weeklyKcalEst: 2000, sessionsCount: 6, completionPct: 90 },
    })
    const patterns = detectRiskPatterns(snap)
    expect(patterns.length).toBeGreaterThanOrEqual(2)
    expect(patterns[0]!.severity).toBe('critical')
  })
})

describe('generateSuggestionsFromPatterns', () => {
  it('mapeia padrão para suggestion + computa proposedChanges', () => {
    const snap = makeSnapshot({
      mealPlan: {
        id: 'p1',
        name: 'Test',
        goal: 'emagrecimento',
        targetKcal: 2000,
        targetProteinG: null,
        targetCarbG: null,
        targetLipidG: null,
        version: 1,
      },
      diaryLast14d: Array.from({ length: 7 }, () => ({
        date: '2026-05-15',
        totalKcal: 900,
        totalProteinG: 0,
        totalCarbG: 0,
        totalFatG: 0,
        mealsCount: 2,
        adherencePct: 40,
      })),
    })
    const patterns = detectRiskPatterns(snap)
    const suggs = generateSuggestionsFromPatterns(patterns, snap)
    expect(suggs.length).toBeGreaterThan(0)
    const defSugg = suggs.find((s) => s.title.includes('Déficit'))
    expect(defSugg?.kind).toBe('plan_adjustment')
    expect(defSugg?.proposedChanges?.targetKcalDelta).toBeDefined()
    expect(defSugg?.proposedChanges?.targetKcalDelta).toBeLessThan(0) // sobe -> ainda negativo
  })

  it('aderência baixa vira alert (sem changes)', () => {
    const snap = makeSnapshot({
      mealPlan: {
        id: 'p1',
        name: 'Test',
        goal: 'manutencao',
        targetKcal: 2000,
        targetProteinG: null,
        targetCarbG: null,
        targetLipidG: null,
        version: 1,
      },
      diaryLast14d: Array.from({ length: 7 }, () => ({
        date: '2026-05-15',
        totalKcal: 1500,
        totalProteinG: 0,
        totalCarbG: 0,
        totalFatG: 0,
        mealsCount: 3,
        adherencePct: 30,
      })),
    })
    const patterns = detectRiskPatterns(snap)
    const suggs = generateSuggestionsFromPatterns(patterns, snap)
    const adh = suggs.find((s) => s.title.toLowerCase().includes('aderência'))
    expect(adh?.kind).toBe('alert')
    expect(adh?.proposedChanges).toBeNull()
  })
})

describe('generatePreConsultSummary', () => {
  it('gera resumo executivo determinístico', () => {
    const snap = makeSnapshot({
      mealPlan: {
        id: 'p1',
        name: 'Emagrece',
        goal: 'emagrecimento',
        targetKcal: 1800,
        targetProteinG: null,
        targetCarbG: null,
        targetLipidG: null,
        version: 3,
      },
      diaryLast14d: Array.from({ length: 7 }, () => ({
        date: '2026-05-15',
        totalKcal: 1600,
        totalProteinG: 0,
        totalCarbG: 0,
        totalFatG: 0,
        mealsCount: 4,
        adherencePct: 85,
      })),
      fisioActiveCids: [
        { cidCode: 'MG30.0', description: 'Lombalgia', consultaSignedAt: '2026-05-01' },
      ],
    })
    const patterns = detectRiskPatterns(snap)
    const summary = generatePreConsultSummary(patterns, snap)
    expect(summary.kind).toBe('pre_consult_summary')
    expect(summary.description).toContain('Emagrece')
    expect(summary.description).toContain('CIDs')
    expect(summary.confidence).toBe(1)
  })

  it('snapshot vazio gera summary sintético sem erro', () => {
    const summary = generatePreConsultSummary([], makeSnapshot())
    expect(summary.description).toContain('Sem plano')
  })
})
