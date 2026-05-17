/**
 * Cashflow forecast + NF-e key validator — Sprint 17 Faixa B tests.
 */
import { describe, expect, it } from 'vitest'
import { forecastCashflow, validateNfeKey } from './cashflow'

describe('forecastCashflow', () => {
  it('forecast 7 dias com 1 AP + 1 AR no meio', () => {
    const r = forecastCashflow({
      currentBalanceCents: 1_000_000,
      futureAps: [{ dueDate: '2026-05-18', amountCents: 380_000 }],
      futureArs: [{ dueDate: '2026-05-20', amountCents: 500_000 }],
      daysAhead: 7,
      startDate: '2026-05-15',
    })
    expect(r).toHaveLength(7)
    expect(r[0]).toMatchObject({
      date: '2026-05-15',
      openingBalance: 1_000_000,
      inflowCents: 0,
      outflowCents: 0,
      closingBalance: 1_000_000,
    })
    // dia 3 (18 maio) tem AP 3800
    expect(r[3]!.outflowCents).toBe(380_000)
    expect(r[3]!.closingBalance).toBe(620_000)
    // dia 5 (20 maio) tem AR 5000
    expect(r[5]!.inflowCents).toBe(500_000)
    expect(r[5]!.closingBalance).toBe(1_120_000)
    // Saldo final preservado
    expect(r[6]!.closingBalance).toBe(1_120_000)
  })

  it('overdue (AP com dueDate passado) absorvido no dia 0', () => {
    const r = forecastCashflow({
      currentBalanceCents: 500_000,
      futureAps: [
        { dueDate: '2026-05-01', amountCents: 200_000 }, // overdue
        { dueDate: '2026-05-20', amountCents: 100_000 },
      ],
      futureArs: [],
      daysAhead: 10,
      startDate: '2026-05-15',
    })
    expect(r[0]!.outflowCents).toBe(200_000)
    expect(r[0]!.closingBalance).toBe(300_000)
    expect(r[0]!.apCount).toBe(1)
  })

  it('múltiplas APs no mesmo dia somadas', () => {
    const r = forecastCashflow({
      currentBalanceCents: 1_000_000,
      futureAps: [
        { dueDate: '2026-05-20', amountCents: 100_000 },
        { dueDate: '2026-05-20', amountCents: 50_000 },
      ],
      futureArs: [],
      daysAhead: 7,
      startDate: '2026-05-15',
    })
    expect(r[5]!.outflowCents).toBe(150_000)
    expect(r[5]!.apCount).toBe(2)
  })

  it('daysAhead clamp a 180', () => {
    const r = forecastCashflow({
      currentBalanceCents: 0,
      futureAps: [],
      futureArs: [],
      daysAhead: 500,
      startDate: '2026-05-15',
    })
    expect(r).toHaveLength(180)
  })
})

describe('validateNfeKey', () => {
  it('chave válida 44 dígitos com DV correto', () => {
    // Chave fictícia gerada algoritmicamente
    const base43 = '3526051234567800010055001000000001100000001'
    const dv = computeDv(base43)
    const chave = base43 + dv
    const r = validateNfeKey(chave)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.uf).toBe('35')
      expect(r.aamm).toBe('2605')
      expect(r.cnpj).toBe('12345678000100')
    }
  })

  it('chave com tamanho errado rejeitada', () => {
    const r = validateNfeKey('1234567890')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/44/)
  })

  it('chave com DV errado rejeitada', () => {
    const chave = '35260512345678000100550010000000011000000010' // DV trocado
    const r = validateNfeKey(chave)
    expect(r.ok).toBe(false)
  })

  it('chave com formatação (espaços/pontos) limpa antes de validar', () => {
    const base43 = '3526051234567800010055001000000001100000001'
    const dv = computeDv(base43)
    const chave = base43 + dv
    const formatado = chave.replace(/(.{4})/g, '$1 ').trim()
    const r = validateNfeKey(formatado)
    expect(r.ok).toBe(true)
  })
})

function computeDv(s: string): string {
  let sum = 0
  let mult = 2
  for (let i = s.length - 1; i >= 0; i--) {
    sum += Number(s[i]) * mult
    mult = mult === 9 ? 2 : mult + 1
  }
  const rest = sum % 11
  return String(rest < 2 ? 0 : 11 - rest)
}
