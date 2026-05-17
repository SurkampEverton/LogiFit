/**
 * Tests calculadoras antropométricas — Sprint 12 Faixa B.
 */
import { describe, expect, it } from 'vitest'
import {
  calculateImc,
  calculateLeanMass,
  calculatePollock7,
  calculateRcq,
  calculateTmbHarrisBenedict,
  calculateTmbKatchMcArdle,
  calculateTmbMifflin,
} from './calc'

describe('calculateImc', () => {
  it('peso 70 altura 175 → IMC 22.86 normal', () => {
    const r = calculateImc({ weightKg: 70, heightCm: 175 })!
    expect(r.value).toBeCloseTo(22.86, 1)
    expect(r.classification).toBe('normal')
  })

  it('peso 100 altura 170 → IMC 34.6 obesidade_i', () => {
    const r = calculateImc({ weightKg: 100, heightCm: 170 })!
    expect(r.value).toBeCloseTo(34.6, 1)
    expect(r.classification).toBe('obesidade_i')
  })

  it('peso 50 altura 175 → baixo_peso', () => {
    const r = calculateImc({ weightKg: 50, heightCm: 175 })!
    expect(r.classification).toBe('baixo_peso')
  })

  it('peso 0 retorna null', () => {
    expect(calculateImc({ weightKg: 0, heightCm: 175 })).toBeNull()
  })

  it('altura negativa retorna null', () => {
    expect(calculateImc({ weightKg: 70, heightCm: -10 })).toBeNull()
  })
})

describe('calculatePollock7 — homem 30 anos', () => {
  it('soma dobras 80mm aos 30a homem → faixa atletico/saudavel coerente', () => {
    const r = calculatePollock7({
      tricipital: 8,
      subescapular: 10,
      supraIliaca: 12,
      abdominal: 18,
      peitoral: 8,
      axilarMedia: 10,
      coxa: 14,
      ageYears: 30,
      sex: 'male',
    })!
    expect(r.value).toBeGreaterThan(5)
    expect(r.value).toBeLessThan(20)
    expect(['atletico', 'saudavel']).toContain(r.classification)
  })

  it('soma alta → sobrepeso/obesidade', () => {
    const r = calculatePollock7({
      tricipital: 25,
      subescapular: 30,
      supraIliaca: 35,
      abdominal: 40,
      peitoral: 30,
      axilarMedia: 25,
      coxa: 28,
      ageYears: 35,
      sex: 'male',
    })!
    expect(r.value).toBeGreaterThan(20)
    expect(['sobrepeso', 'obesidade']).toContain(r.classification)
  })

  it('idade inválida retorna null', () => {
    expect(
      calculatePollock7({
        tricipital: 8,
        subescapular: 10,
        supraIliaca: 12,
        abdominal: 18,
        peitoral: 8,
        axilarMedia: 10,
        coxa: 14,
        ageYears: 0,
        sex: 'male',
      }),
    ).toBeNull()
  })

  it('soma 0 retorna null', () => {
    expect(
      calculatePollock7({
        tricipital: 0,
        subescapular: 0,
        supraIliaca: 0,
        abdominal: 0,
        peitoral: 0,
        axilarMedia: 0,
        coxa: 0,
        ageYears: 30,
        sex: 'male',
      }),
    ).toBeNull()
  })

  it('mulher tem bands diferentes', () => {
    const r = calculatePollock7({
      tricipital: 15,
      subescapular: 12,
      supraIliaca: 18,
      abdominal: 20,
      peitoral: 10,
      axilarMedia: 12,
      coxa: 20,
      ageYears: 30,
      sex: 'female',
    })!
    expect(r.value).toBeGreaterThan(15)
    expect(r.classification).toBeDefined()
  })
})

describe('calculateTmbMifflin', () => {
  it('homem 30a 70kg 175cm → ~1648 kcal', () => {
    const r = calculateTmbMifflin({
      weightKg: 70,
      heightCm: 175,
      ageYears: 30,
      sex: 'male',
    })!
    // 10*70 + 6.25*175 - 5*30 + 5 = 700 + 1093.75 - 150 + 5 = 1648.75
    expect(r.value).toBeCloseTo(1648.75, 1)
  })

  it('mulher 30a 60kg 165cm → ~1320 kcal', () => {
    const r = calculateTmbMifflin({
      weightKg: 60,
      heightCm: 165,
      ageYears: 30,
      sex: 'female',
    })!
    // 10*60 + 6.25*165 - 5*30 - 161 = 600 + 1031.25 - 150 - 161 = 1320.25
    expect(r.value).toBeCloseTo(1320.25, 1)
  })

  it('peso 0 retorna null', () => {
    expect(
      calculateTmbMifflin({
        weightKg: 0,
        heightCm: 175,
        ageYears: 30,
        sex: 'male',
      }),
    ).toBeNull()
  })

  it('idade 150 retorna null (range)', () => {
    expect(
      calculateTmbMifflin({
        weightKg: 70,
        heightCm: 175,
        ageYears: 150,
        sex: 'male',
      }),
    ).toBeNull()
  })
})

describe('calculateTmbHarrisBenedict', () => {
  it('homem 30a 70kg 175cm → ~1696 kcal (mais alto que Mifflin, conhecido)', () => {
    const r = calculateTmbHarrisBenedict({
      weightKg: 70,
      heightCm: 175,
      ageYears: 30,
      sex: 'male',
    })!
    // 88.362 + 13.397*70 + 4.799*175 - 5.677*30
    // = 88.362 + 937.79 + 839.825 - 170.31 = 1695.67
    expect(r.value).toBeCloseTo(1695.67, 1)
  })

  it('mulher 30a 60kg 165cm → ~1372', () => {
    const r = calculateTmbHarrisBenedict({
      weightKg: 60,
      heightCm: 165,
      ageYears: 30,
      sex: 'female',
    })!
    // 447.593 + 9.247*60 + 3.098*165 - 4.330*30
    // = 447.593 + 554.82 + 511.17 - 129.9 = 1383.68
    expect(r.value).toBeCloseTo(1383.68, 1)
  })
})

describe('calculateTmbKatchMcArdle', () => {
  it('LBM 55kg → 370 + 21.6×55 = 1558', () => {
    const r = calculateTmbKatchMcArdle({ leanMassKg: 55 })!
    expect(r.value).toBe(1558)
  })

  it('LBM 0 retorna null', () => {
    expect(calculateTmbKatchMcArdle({ leanMassKg: 0 })).toBeNull()
  })
})

describe('calculateRcq', () => {
  it('homem cintura 85 quadril 95 → 0.89 baixo', () => {
    const r = calculateRcq({ waistCm: 85, hipCm: 95, sex: 'male' })!
    expect(r.value).toBeCloseTo(0.89, 2)
    expect(r.classification).toBe('baixo')
  })

  it('homem cintura 100 quadril 105 → 0.95 moderado', () => {
    const r = calculateRcq({ waistCm: 100, hipCm: 105, sex: 'male' })!
    expect(r.classification).toBe('moderado')
  })

  it('homem cintura 105 quadril 95 → >=1.0 alto', () => {
    const r = calculateRcq({ waistCm: 105, hipCm: 95, sex: 'male' })!
    expect(r.classification).toBe('alto')
  })

  it('mulher cintura 75 quadril 100 → 0.75 baixo', () => {
    const r = calculateRcq({ waistCm: 75, hipCm: 100, sex: 'female' })!
    expect(r.classification).toBe('baixo')
  })

  it('mulher cintura 85 quadril 100 → 0.85 alto', () => {
    const r = calculateRcq({ waistCm: 85, hipCm: 100, sex: 'female' })!
    expect(r.classification).toBe('alto')
  })

  it('quadril 0 retorna null', () => {
    expect(calculateRcq({ waistCm: 80, hipCm: 0, sex: 'male' })).toBeNull()
  })
})

describe('calculateLeanMass', () => {
  it('80kg × 20% gordura → 64kg LBM', () => {
    const r = calculateLeanMass(80, 20)!
    expect(r.value).toBeCloseTo(64, 1)
  })

  it('peso 0 retorna null', () => {
    expect(calculateLeanMass(0, 20)).toBeNull()
  })

  it('% gordura 75 (fora range) retorna null', () => {
    expect(calculateLeanMass(80, 75)).toBeNull()
  })
})
