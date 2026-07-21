/**
 * anvisa.ts tests — Sprint 25 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  type ChecklistItem,
  type MaintenanceWindow,
  checkCleaningStatus,
  classifyMaintenances,
  pickAttentionItems,
  validateChecklist,
  validateCnesCode,
} from './anvisa'

describe('classifyMaintenances', () => {
  const today = '2026-05-17'

  it('vencida → overdue', () => {
    const r = classifyMaintenances(
      [{ equipmentId: 'e1', plannedFor: '2026-05-01', kind: 'preventive', status: 'scheduled' }],
      today,
    )
    expect(r[0]!.urgency).toBe('overdue')
    expect(r[0]!.daysUntil).toBeLessThan(0)
  })

  it('D-5 → d7', () => {
    const r = classifyMaintenances(
      [{ equipmentId: 'e1', plannedFor: '2026-05-22', kind: 'calibration', status: 'scheduled' }],
      today,
    )
    expect(r[0]!.urgency).toBe('d7')
    expect(r[0]!.daysUntil).toBe(5)
  })

  it('D-15 → d30', () => {
    const r = classifyMaintenances(
      [{ equipmentId: 'e1', plannedFor: '2026-06-01', kind: 'preventive', status: 'scheduled' }],
      today,
    )
    expect(r[0]!.urgency).toBe('d30')
  })

  it('D-60 → ok', () => {
    const r = classifyMaintenances(
      [{ equipmentId: 'e1', plannedFor: '2026-07-30', kind: 'preventive', status: 'scheduled' }],
      today,
    )
    expect(r[0]!.urgency).toBe('ok')
  })

  it('completed/cancelled ignorados', () => {
    const windows: MaintenanceWindow[] = [
      { equipmentId: 'e1', plannedFor: '2026-05-01', kind: 'preventive', status: 'completed' },
      { equipmentId: 'e2', plannedFor: '2026-05-01', kind: 'corrective', status: 'cancelled' },
      { equipmentId: 'e3', plannedFor: '2026-05-01', kind: 'preventive', status: 'scheduled' },
    ]
    const r = classifyMaintenances(windows, today)
    expect(r).toHaveLength(1)
    expect(r[0]!.equipmentId).toBe('e3')
  })

  it('pickAttentionItems filtra só os que precisam atenção', () => {
    const r = pickAttentionItems(
      classifyMaintenances(
        [
          { equipmentId: 'e1', plannedFor: '2026-05-01', kind: 'preventive', status: 'scheduled' }, // overdue
          { equipmentId: 'e2', plannedFor: '2026-05-22', kind: 'calibration', status: 'scheduled' }, // d7
          { equipmentId: 'e3', plannedFor: '2026-07-30', kind: 'preventive', status: 'scheduled' }, // ok
        ],
        today,
      ),
    )
    expect(r).toHaveLength(2)
    expect(r.map((c) => c.equipmentId).sort()).toEqual(['e1', 'e2'])
  })
})

describe('validateChecklist', () => {
  const items: ChecklistItem[] = [
    { key: 'alcool_70', label: 'Álcool 70%', required: true },
    { key: 'descarte_perfurocortantes', label: 'Descarte de perfurocortantes', required: true },
    { key: 'troca_lencois', label: 'Troca de lençóis', required: false },
  ]

  it('todos required cumpridos → isComplete=true', () => {
    const r = validateChecklist({
      items,
      itemsDone: ['alcool_70', 'descarte_perfurocortantes'],
    })
    expect(r.isComplete).toBe(true)
    expect(r.missingRequired).toHaveLength(0)
    expect(r.completionPct).toBe(67) // 2 de 3 = 67%
  })

  it('falta required → isComplete=false + missing listado', () => {
    const r = validateChecklist({
      items,
      itemsDone: ['troca_lencois'],
    })
    expect(r.isComplete).toBe(false)
    expect(r.missingRequired).toContain('alcool_70')
    expect(r.missingRequired).toContain('descarte_perfurocortantes')
    expect(r.completionPct).toBe(33)
  })

  it('todos cumpridos (incluindo opcionais) → 100%', () => {
    const r = validateChecklist({
      items,
      itemsDone: ['alcool_70', 'descarte_perfurocortantes', 'troca_lencois'],
    })
    expect(r.completionPct).toBe(100)
    expect(r.isComplete).toBe(true)
  })

  it('lista vazia de items → isComplete=false', () => {
    const r = validateChecklist({ items: [], itemsDone: [] })
    expect(r.isComplete).toBe(false)
    expect(r.completionPct).toBe(0)
  })

  it('items_done com key inexistente é ignorada', () => {
    const r = validateChecklist({
      items,
      itemsDone: ['alcool_70', 'descarte_perfurocortantes', 'invalida'],
    })
    expect(r.isComplete).toBe(true)
    expect(r.totalDone).toBe(2) // não conta a inexistente
  })
})

describe('validateCnesCode', () => {
  it('7 dígitos válido', () => {
    const r = validateCnesCode('1234567')
    expect(r.ok).toBe(true)
    expect(r.normalized).toBe('1234567')
  })

  it('com máscara aceita', () => {
    const r = validateCnesCode('12.34567-0')
    expect(r.ok).toBe(false) // 9 dígitos após remover
  })

  it('formato com hífen mas 7 dígitos', () => {
    const r = validateCnesCode('123-4567')
    expect(r.ok).toBe(true)
    expect(r.normalized).toBe('1234567')
  })

  it('vazio rejeitado', () => {
    expect(validateCnesCode('').ok).toBe(false)
    expect(validateCnesCode(null).ok).toBe(false)
  })

  it('6 dígitos rejeitado', () => {
    const r = validateCnesCode('123456')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('7 dígitos')
  })

  it('8 dígitos rejeitado', () => {
    expect(validateCnesCode('12345678').ok).toBe(false)
  })
})

describe('checkCleaningStatus', () => {
  it('nunca feito → overdue', () => {
    const r = checkCleaningStatus({
      checklistId: 'c1',
      unitId: 'u1',
      frequencyDays: 1,
      lastPerformedAt: null,
    })
    expect(r.isOverdue).toBe(true)
    expect(r.hoursSinceLast).toBeNull()
  })

  it('dentro do prazo → ok', () => {
    const today = '2026-05-17T10:00:00Z'
    const lastPerformedAt = '2026-05-17T08:00:00Z' // 2h atrás
    const r = checkCleaningStatus({
      checklistId: 'c1',
      unitId: 'u1',
      frequencyDays: 1,
      lastPerformedAt,
      today,
    })
    expect(r.isOverdue).toBe(false)
    expect(r.hoursSinceLast).toBe(2)
  })

  it('passou da frequency → overdue', () => {
    const today = '2026-05-19T10:00:00Z'
    const lastPerformedAt = '2026-05-17T10:00:00Z' // 48h atrás
    const r = checkCleaningStatus({
      checklistId: 'c1',
      unitId: 'u1',
      frequencyDays: 1,
      lastPerformedAt,
      today,
    })
    expect(r.isOverdue).toBe(true)
    expect(r.hoursSinceLast).toBe(48)
  })

  it('semanal — 5 dias = ok', () => {
    const today = '2026-05-22T10:00:00Z'
    const lastPerformedAt = '2026-05-17T10:00:00Z' // 5 dias
    const r = checkCleaningStatus({
      checklistId: 'c1',
      unitId: 'u1',
      frequencyDays: 7,
      lastPerformedAt,
      today,
    })
    expect(r.isOverdue).toBe(false)
  })
})
