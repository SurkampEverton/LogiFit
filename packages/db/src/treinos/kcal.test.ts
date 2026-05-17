/**
 * Tests calculateKcalPerSession — Sprint 11 Faixa B (ADR 0070).
 */
import { describe, expect, it } from 'vitest'
import { calculateKcalPerSession } from './kcal'

describe('calculateKcalPerSession', () => {
  it('caso canônico: 3 exercises ponderado por sets, member 80kg, 45min', () => {
    const result = calculateKcalPerSession({
      items: [
        { met: 5.0, sets: 3 },
        { met: 6.0, sets: 4 },
        { met: 4.0, sets: 3 },
      ],
      weightKg: 80,
      durationMin: 45,
    })
    // averageMet = (15+24+12)/10 = 5.1
    // kcal = 5.1 × 80 × 0.75 = 306
    expect(result.averageMet).toBeCloseTo(5.1, 1)
    expect(result.kcal).toBeCloseTo(306, 0)
    expect(result.effectiveWeightKg).toBe(80)
  })

  it('weight=0 dispara fallback 70kg', () => {
    const result = calculateKcalPerSession({
      items: [{ met: 6.0, sets: 3 }],
      weightKg: 0,
      durationMin: 30,
    })
    expect(result.effectiveWeightKg).toBe(70)
    // kcal = 6.0 × 70 × 0.5 = 210
    expect(result.kcal).toBeCloseTo(210, 0)
  })

  it('weight negativo dispara fallback', () => {
    const result = calculateKcalPerSession({
      items: [{ met: 4.0, sets: 2 }],
      weightKg: -50,
      durationMin: 60,
    })
    expect(result.effectiveWeightKg).toBe(70)
    expect(result.kcal).toBeCloseTo(280, 0)
  })

  it('items com MET inválido (≤0) são ignorados', () => {
    const result = calculateKcalPerSession({
      items: [
        { met: 5.0, sets: 3 },
        { met: 0, sets: 5 }, // ignorado
        { met: -2, sets: 3 }, // ignorado
        { met: 6.0, sets: 2 },
      ],
      weightKg: 70,
      durationMin: 60,
    })
    // averageMet = (15+12)/5 = 5.4 (só conta sets dos items válidos)
    expect(result.averageMet).toBeCloseTo(5.4, 1)
  })

  it('duration 0 retorna 0 kcal', () => {
    const result = calculateKcalPerSession({
      items: [{ met: 8.0, sets: 5 }],
      weightKg: 80,
      durationMin: 0,
    })
    expect(result.kcal).toBe(0)
  })

  it('duration negativa retorna 0 kcal', () => {
    const result = calculateKcalPerSession({
      items: [{ met: 8.0, sets: 5 }],
      weightKg: 80,
      durationMin: -10,
    })
    expect(result.kcal).toBe(0)
  })

  it('items vazio retorna 0 kcal', () => {
    const result = calculateKcalPerSession({
      items: [],
      weightKg: 80,
      durationMin: 60,
    })
    expect(result.kcal).toBe(0)
  })

  it('todos items inválidos retorna 0', () => {
    const result = calculateKcalPerSession({
      items: [
        { met: -1, sets: 3 },
        { met: 0, sets: 5 },
      ],
      weightKg: 80,
      durationMin: 45,
    })
    expect(result.kcal).toBe(0)
    expect(result.averageMet).toBe(0)
  })

  it('clampeado em 5000 kcal (proteção contra duration absurda)', () => {
    // Simulação: HIIT extremo MET 12, 200kg, 10h (input absurdo)
    const result = calculateKcalPerSession({
      items: [{ met: 12.0, sets: 10 }],
      weightKg: 200,
      durationMin: 600,
    })
    // raw = 12 × 200 × 10 = 24000 → clampeado em 5000
    expect(result.kcal).toBe(5000)
  })

  it('sets=0 ou negativo são ignorados (sem dividir por zero)', () => {
    const result = calculateKcalPerSession({
      items: [
        { met: 5.0, sets: 0 },
        { met: 6.0, sets: -2 },
      ],
      weightKg: 70,
      durationMin: 60,
    })
    expect(result.kcal).toBe(0)
    expect(result.averageMet).toBe(0)
  })

  it('valor com 2 casas decimais', () => {
    const result = calculateKcalPerSession({
      items: [{ met: 3.33, sets: 3 }],
      weightKg: 72.5,
      durationMin: 33,
    })
    // 3.33 × 72.5 × 0.55 = 132.78375 → arredondado pra 132.78
    expect(result.kcal).toBeCloseTo(132.78, 2)
  })
})
