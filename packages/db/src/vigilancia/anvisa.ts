/**
 * Vigilância Sanitária utils — Sprint 25 Faixa B.1.
 *
 * Funções puras: detecção de manutenção vencida + validação de checklist
 * de limpeza + validação de formato CNES.
 */

// ─── Manutenção vencida + próximos alertas ──────────────────────────────

export interface MaintenanceWindow {
  equipmentId: string
  plannedFor: string // YYYY-MM-DD
  kind: 'preventive' | 'calibration' | 'corrective'
  status:
    | 'scheduled'
    | 'in_transit_to_external'
    | 'at_external'
    | 'returning'
    | 'completed'
    | 'overdue'
    | 'cancelled'
}

export type MaintenanceUrgency = 'overdue' | 'd7' | 'd30' | 'ok'

export interface MaintenanceCheck {
  equipmentId: string
  plannedFor: string
  kind: MaintenanceWindow['kind']
  urgency: MaintenanceUrgency
  daysUntil: number // negativo se vencida
}

/**
 * Classifica cada manutenção por urgência relativa a hoje:
 *   - `overdue` se plannedFor < today
 *   - `d7` se plannedFor ≤ today + 7 dias
 *   - `d30` se plannedFor ≤ today + 30 dias
 *   - `ok` caso contrário
 *
 * Ignora status='completed'|'cancelled'.
 */
export function classifyMaintenances(
  windows: MaintenanceWindow[],
  today: string = new Date().toISOString().slice(0, 10),
): MaintenanceCheck[] {
  const todayMs = new Date(`${today}T00:00:00Z`).getTime()
  return windows
    .filter((w) => w.status !== 'completed' && w.status !== 'cancelled')
    .map((w) => {
      const plannedMs = new Date(`${w.plannedFor}T00:00:00Z`).getTime()
      const daysUntil = Math.round((plannedMs - todayMs) / (24 * 60 * 60 * 1000))
      let urgency: MaintenanceUrgency = 'ok'
      if (daysUntil < 0) urgency = 'overdue'
      else if (daysUntil <= 7) urgency = 'd7'
      else if (daysUntil <= 30) urgency = 'd30'
      return {
        equipmentId: w.equipmentId,
        plannedFor: w.plannedFor,
        kind: w.kind,
        urgency,
        daysUntil,
      }
    })
}

/**
 * Filtra os que precisam de atenção (overdue + d7 + d30).
 */
export function pickAttentionItems(checks: MaintenanceCheck[]): MaintenanceCheck[] {
  return checks.filter((c) => c.urgency !== 'ok')
}

// ─── Limpeza: validação de checklist ───────────────────────────────────

export interface ChecklistItem {
  key: string
  label: string
  required: boolean
}

export interface ChecklistValidation {
  isComplete: boolean
  completionPct: number
  missingRequired: string[]
  totalRequired: number
  totalDone: number
}

/**
 * Valida um log de limpeza contra a estrutura do checklist.
 *   - completionPct = (itensFeitos / totalItens) × 100
 *   - isComplete = todos required cumpridos
 *   - missingRequired = keys de items required ausentes
 */
export function validateChecklist(input: {
  items: ChecklistItem[]
  itemsDone: string[]
}): ChecklistValidation {
  const done = new Set(input.itemsDone)
  const requiredKeys = input.items.filter((i) => i.required).map((i) => i.key)
  const missingRequired = requiredKeys.filter((k) => !done.has(k))
  const totalItems = input.items.length
  const totalDone = input.items.filter((i) => done.has(i.key)).length
  const completionPct = totalItems === 0 ? 0 : Math.round((totalDone / totalItems) * 100)
  return {
    isComplete: missingRequired.length === 0 && totalItems > 0,
    completionPct,
    missingRequired,
    totalRequired: requiredKeys.length,
    totalDone,
  }
}

// ─── CNES ──────────────────────────────────────────────────────────────

export interface CnesValidation {
  ok: boolean
  normalized?: string
  reason?: string
}

/**
 * Valida formato CNES — 7 dígitos numéricos. Aceita com ou sem máscara.
 * Retorna versão normalizada (apenas dígitos) quando válido.
 */
export function validateCnesCode(code: string | null | undefined): CnesValidation {
  if (!code || code.trim() === '') {
    return { ok: false, reason: 'CNES vazio' }
  }
  const normalized = code.replace(/\D/g, '')
  if (normalized.length !== 7) {
    return {
      ok: false,
      reason: 'CNES deve ter exatamente 7 dígitos (formato Datasus)',
    }
  }
  // CNES é inteiro de 1-9999999; primeiro dígito não-zero
  if (!/^[0-9]{7}$/.test(normalized)) {
    return { ok: false, reason: 'CNES deve conter apenas dígitos' }
  }
  return { ok: true, normalized }
}

// ─── Atraso de limpeza ──────────────────────────────────────────────────

export interface CleaningStatus {
  checklistId: string
  unitId: string | null
  lastPerformedAt: string | null
  frequencyDays: number
  isOverdue: boolean
  hoursSinceLast: number | null
}

/**
 * Detecta se a limpeza de um checklist está atrasada (passou da frequency).
 */
export function checkCleaningStatus(input: {
  checklistId: string
  unitId: string | null
  frequencyDays: number
  lastPerformedAt: string | null
  today?: string
}): CleaningStatus {
  const today = input.today ?? new Date().toISOString()
  const todayMs = new Date(today).getTime()
  if (!input.lastPerformedAt) {
    return {
      checklistId: input.checklistId,
      unitId: input.unitId,
      lastPerformedAt: null,
      frequencyDays: input.frequencyDays,
      isOverdue: true, // nunca feito = overdue
      hoursSinceLast: null,
    }
  }
  const lastMs = new Date(input.lastPerformedAt).getTime()
  const hoursSinceLast = (todayMs - lastMs) / (60 * 60 * 1000)
  const maxHours = input.frequencyDays * 24
  return {
    checklistId: input.checklistId,
    unitId: input.unitId,
    lastPerformedAt: input.lastPerformedAt,
    frequencyDays: input.frequencyDays,
    isOverdue: hoursSinceLast > maxHours,
    hoursSinceLast: Math.round(hoursSinceLast),
  }
}
