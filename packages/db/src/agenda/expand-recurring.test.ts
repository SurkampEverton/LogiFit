/**
 * `expandRecurring` — unit tests (Sprint 03 Faixa D, ADR 0012).
 *
 * Smoke tests com rrule.js fixos — sem dependência de DB.
 */
import { describe, expect, it } from 'vitest'
import { expandRecurring } from './expand-recurring'

describe('expandRecurring', () => {
  it('FREQ=WEEKLY;BYDAY=MO retorna segundas dentro do range', () => {
    // Range: terça 2026-06-02 → segunda 2026-06-15 → 2 segundas (08 e 15)
    const result = expandRecurring({
      recurringSlotId: 'slot-1',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      startTime: '18:00:00',
      endTime: '19:00:00',
      rangeStart: new Date('2026-06-02T00:00:00Z'),
      rangeEnd: new Date('2026-06-15T23:59:59Z'),
    })
    expect(result.length).toBe(2)
    expect(result[0]?.startsAt).toBe('2026-06-08T18:00:00.000Z')
    expect(result[0]?.endsAt).toBe('2026-06-08T19:00:00.000Z')
    expect(result[1]?.startsAt).toBe('2026-06-15T18:00:00.000Z')
  })

  it('FREQ=DAILY retorna ocorrência por dia', () => {
    const result = expandRecurring({
      recurringSlotId: 'slot-2',
      rrule: 'FREQ=DAILY',
      startTime: '07:00:00',
      endTime: '07:30:00',
      rangeStart: new Date('2026-06-01T00:00:00Z'),
      rangeEnd: new Date('2026-06-05T23:59:59Z'),
    })
    expect(result.length).toBe(5) // 01/06 → 05/06
    expect(result.every((s) => s.startsAt.endsWith('T07:00:00.000Z'))).toBe(true)
  })

  it('FREQ=WEEKLY;BYDAY=TU,TH retorna terça e quinta', () => {
    const result = expandRecurring({
      recurringSlotId: 'slot-3',
      rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
      startTime: '10:00:00',
      endTime: '11:00:00',
      // Semana de 01/06 (segunda) a 07/06 (domingo) → 1 terça (02) + 1 quinta (04)
      rangeStart: new Date('2026-06-01T00:00:00Z'),
      rangeEnd: new Date('2026-06-07T23:59:59Z'),
    })
    expect(result.length).toBe(2)
    expect(result[0]?.startsAt).toContain('2026-06-02')
    expect(result[1]?.startsAt).toContain('2026-06-04')
  })

  it('RRULE inválido retorna array vazio (não lança)', () => {
    const result = expandRecurring({
      recurringSlotId: 'slot-bad',
      rrule: 'BLAH BLAH NOT VALID',
      startTime: '10:00:00',
      endTime: '11:00:00',
      rangeStart: new Date('2026-06-01T00:00:00Z'),
      rangeEnd: new Date('2026-06-07T23:59:59Z'),
    })
    expect(result).toEqual([])
  })

  it('Range vazio retorna array vazio', () => {
    const result = expandRecurring({
      recurringSlotId: 'slot-empty',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      startTime: '10:00:00',
      endTime: '11:00:00',
      // Range que não pega nenhuma segunda (terça → quarta)
      rangeStart: new Date('2026-06-02T00:00:00Z'),
      rangeEnd: new Date('2026-06-03T23:59:59Z'),
    })
    expect(result).toEqual([])
  })

  it('Carrega recurringSlotId no payload', () => {
    const result = expandRecurring({
      recurringSlotId: 'abc-123',
      rrule: 'FREQ=DAILY',
      startTime: '09:00:00',
      endTime: '10:00:00',
      rangeStart: new Date('2026-06-01T00:00:00Z'),
      rangeEnd: new Date('2026-06-01T23:59:59Z'),
    })
    expect(result.length).toBe(1)
    expect(result[0]?.recurringSlotId).toBe('abc-123')
  })
})
