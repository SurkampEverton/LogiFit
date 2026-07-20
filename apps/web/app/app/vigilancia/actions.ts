'use server'

/**
 * Server Actions Vigilância Sanitária — Sprint 25 Faixa B.2.
 *
 * MVP:
 *   - createEquipment / updateEquipment / decommissionEquipment / listEquipment
 *   - scheduleMaintenance / completeMaintenance / listMaintenances
 *   - recordUsage (rastreabilidade clínica)
 *   - createCleaningChecklist / listCleaningChecklists
 *   - recordCleaning (com validação via lib pura)
 *   - listLowAttentionMaintenance (overdue + D-7 + D-30)
 *   - validateCnesCodeAction (helper UI)
 *
 * **Sprint 25b futuro:** integração Datasus CNES + fluxo NF-e remessa
 * 5.915/retorno 1.916 (ADR 0059) + bucket Storage para certificados.
 */

import { db } from '@repo/db/client'
import {
  cleaningChecklists,
  cleaningLogs,
  equipment,
  equipmentMaintenance,
  equipmentUsageLog,
} from '@repo/db/schema'
import {
  type ChecklistItem,
  type MaintenanceWindow,
  checkCleaningStatus,
  classifyMaintenances,
  pickAttentionItems,
  validateChecklist,
  validateCnesCode,
} from '@repo/db/vigilancia'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

const EquipmentKindEnum = z.enum([
  'ultrassom',
  'tens',
  'laser',
  'crioterapia',
  'eletroestimulacao',
  'esteira',
  'bicicleta',
  'balanca_bioimpedancia',
  'pressao_arterial',
  'glicosimetro',
  'oximetro',
  'outro',
])

const MaintenanceKindEnum = z.enum(['preventive', 'calibration', 'corrective'])

// ─── Zod ─────────────────────────────────────────────────────────────────

const CreateEquipmentInputSchema = z.object({
  companyId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  kind: EquipmentKindEnum,
  manufacturer: z.string().min(2).max(120),
  model: z.string().min(1).max(120),
  serialNumber: z.string().min(1).max(80),
  anvisaRegistration: z.string().max(40).optional().nullable(),
  acquiredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  warrantyUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  maintenanceIntervalDays: z.number().int().positive().optional().nullable(),
  calibrationIntervalDays: z.number().int().positive().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

const DecommissionInputSchema = z.object({
  equipmentId: z.string().uuid(),
  reason: z.string().min(3).max(500),
})

const ScheduleMaintenanceInputSchema = z.object({
  equipmentId: z.string().uuid(),
  kind: MaintenanceKindEnum,
  plannedFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  externalLocation: z.boolean().default(false),
  externalSupplierId: z.string().uuid().optional().nullable(),
  observations: z.string().max(2000).optional().nullable(),
})

const CompleteMaintenanceInputSchema = z.object({
  maintenanceId: z.string().uuid(),
  performedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  performedByText: z.string().max(200).optional().nullable(),
  certificateStoragePath: z.string().max(500).optional().nullable(),
  certificateContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
    .nullable(),
  costCents: z.number().int().min(0).optional().nullable(),
  observations: z.string().max(2000).optional().nullable(),
})

const RecordUsageInputSchema = z.object({
  equipmentId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  durationMinutes: z.number().int().positive().optional().nullable(),
  parameters: z.record(z.string(), z.unknown()).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})

const CreateChecklistInputSchema = z.object({
  companyId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  name: z.string().min(2).max(120),
  items: z
    .array(
      z.object({
        key: z.string().min(2).max(60),
        label: z.string().min(2).max(120),
        required: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
  frequencyDays: z.number().int().positive().max(365).default(1),
})

const RecordCleaningInputSchema = z.object({
  checklistId: z.string().uuid(),
  itemsDone: z.array(z.string()).default([]),
  observations: z.string().max(1000).optional().nullable(),
})

const ValidateCnesInputSchema = z.object({
  code: z.string().max(20),
})

// ─── createEquipment ────────────────────────────────────────────────────

export const createEquipment = wrapServerAction(
  { module: 'vigilancia', action: 'equipment.create', resourceType: 'equipment' },
  async (input: z.infer<typeof CreateEquipmentInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateEquipmentInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    try {
      const [row] = await db
        .insert(equipment)
        .values({
          tenantId,
          companyId: parsed.companyId,
          unitId: parsed.unitId ?? null,
          kind: parsed.kind,
          manufacturer: parsed.manufacturer,
          model: parsed.model,
          serialNumber: parsed.serialNumber,
          anvisaRegistration: parsed.anvisaRegistration ?? null,
          acquiredAt: parsed.acquiredAt,
          warrantyUntil: parsed.warrantyUntil ?? null,
          maintenanceIntervalDays: parsed.maintenanceIntervalDays ?? null,
          calibrationIntervalDays: parsed.calibrationIntervalDays ?? null,
          notes: parsed.notes ?? null,
          createdByUserId: session.logifit.userId,
        })
        .returning({ id: equipment.id })
      setAuditResource(row!.id, { manufacturer: parsed.manufacturer, model: parsed.model })
      return { id: row!.id }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: `Equipamento ${parsed.manufacturer} ${parsed.serialNumber} já cadastrado (serial unique global)`,
          request_id: '',
        })
      }
      throw err
    }
  },
)

export const decommissionEquipment = wrapServerAction(
  {
    module: 'vigilancia',
    action: 'equipment.decommission',
    resourceType: 'equipment',
  },
  async (input: z.infer<typeof DecommissionInputSchema>, { session, setAuditResource }) => {
    const parsed = DecommissionInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .update(equipment)
      .set({
        status: 'decommissioned',
        decommissionedAt: new Date(),
        decommissionedReason: parsed.reason,
        updatedAt: new Date(),
      })
      .where(and(eq(equipment.id, parsed.equipmentId), eq(equipment.tenantId, tenantId)))
      .returning({ id: equipment.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Equipamento não encontrado',
        request_id: '',
      })
    setAuditResource(row.id, { reason: parsed.reason })
    return { ok: true }
  },
)

export const listEquipment = wrapServerAction(
  { module: 'vigilancia', action: 'equipment.list' },
  async (
    input: { companyId?: string; includeDecommissioned?: boolean } | undefined,
    { session },
  ) => {
    const parsed = z
      .object({
        companyId: z.string().uuid().optional(),
        includeDecommissioned: z.boolean().optional(),
      })
      .parse(input ?? {})
    const tenantId = session.logifit.tenantId
    const where = [eq(equipment.tenantId, tenantId)]
    if (parsed.companyId) where.push(eq(equipment.companyId, parsed.companyId))
    if (!parsed.includeDecommissioned) {
      where.push(sql`${equipment.status} != 'decommissioned'`)
    }
    const rows = await db
      .select()
      .from(equipment)
      .where(and(...where))
      .orderBy(asc(equipment.kind), asc(equipment.manufacturer), asc(equipment.model))
      .limit(500)
    return { equipment: rows }
  },
)

// ─── scheduleMaintenance ───────────────────────────────────────────────

export const scheduleMaintenance = wrapServerAction(
  {
    module: 'vigilancia',
    action: 'maintenance.schedule',
    resourceType: 'equipment_maintenance',
  },
  async (input: z.infer<typeof ScheduleMaintenanceInputSchema>, { session, setAuditResource }) => {
    const parsed = ScheduleMaintenanceInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [eq] = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(and(eq2(equipment.id, parsed.equipmentId), eq2(equipment.tenantId, tenantId)))
      .limit(1)
    if (!eq)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Equipamento não encontrado',
        request_id: '',
      })

    if (parsed.externalLocation && !parsed.externalSupplierId) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'externalLocation=true exige externalSupplierId (fabricante/laboratório)',
        request_id: '',
      })
    }

    try {
      const [row] = await db
        .insert(equipmentMaintenance)
        .values({
          tenantId,
          equipmentId: parsed.equipmentId,
          kind: parsed.kind,
          plannedFor: parsed.plannedFor,
          status: 'scheduled',
          externalLocation: parsed.externalLocation,
          externalSupplierId: parsed.externalSupplierId ?? null,
          observations: parsed.observations ?? null,
          createdByUserId: session.logifit.userId,
        })
        .returning({ id: equipmentMaintenance.id })

      // Se for manutenção: atualiza status do equipamento
      if (parsed.externalLocation) {
        await db
          .update(equipment)
          .set({ status: 'maintenance', updatedAt: new Date() })
          .where(eq2(equipment.id, parsed.equipmentId))
      }
      setAuditResource(row!.id, { kind: parsed.kind, plannedFor: parsed.plannedFor })
      return { id: row!.id }
    } catch (err) {
      throw err
    }
  },
)

export const completeMaintenance = wrapServerAction(
  {
    module: 'vigilancia',
    action: 'maintenance.complete',
    resourceType: 'equipment_maintenance',
  },
  async (input: z.infer<typeof CompleteMaintenanceInputSchema>, { session, setAuditResource }) => {
    const parsed = CompleteMaintenanceInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [maint] = await db
      .select({
        id: equipmentMaintenance.id,
        equipmentId: equipmentMaintenance.equipmentId,
        kind: equipmentMaintenance.kind,
        status: equipmentMaintenance.status,
      })
      .from(equipmentMaintenance)
      .where(
        and(
          eq2(equipmentMaintenance.id, parsed.maintenanceId),
          eq2(equipmentMaintenance.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!maint)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Manutenção não encontrada',
        request_id: '',
      })
    if (maint.status === 'completed' || maint.status === 'cancelled')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Manutenção já finalizada/cancelada',
        request_id: '',
      })

    await db
      .update(equipmentMaintenance)
      .set({
        status: 'completed',
        performedAt: parsed.performedAt,
        performedByText: parsed.performedByText ?? null,
        certificateStoragePath: parsed.certificateStoragePath ?? null,
        certificateContentHash: parsed.certificateContentHash ?? null,
        costCents: parsed.costCents ?? null,
        observations: parsed.observations ?? null,
        completedByUserId: session.logifit.userId,
        externalReturnedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq2(equipmentMaintenance.id, parsed.maintenanceId))

    // Atualiza last_*_at do equipamento
    const updateFields: Record<string, unknown> = {
      status: 'active',
      updatedAt: new Date(),
    }
    if (maint.kind === 'preventive' || maint.kind === 'corrective') {
      updateFields.lastMaintenanceAt = parsed.performedAt
    } else if (maint.kind === 'calibration') {
      updateFields.lastCalibrationAt = parsed.performedAt
    }
    await db.update(equipment).set(updateFields).where(eq2(equipment.id, maint.equipmentId))

    setAuditResource(maint.id, { kind: maint.kind })
    return { ok: true }
  },
)

export const listMaintenances = wrapServerAction(
  { module: 'vigilancia', action: 'maintenance.list' },
  async (input: { equipmentId?: string; status?: string } | undefined, { session }) => {
    const parsed = z
      .object({
        equipmentId: z.string().uuid().optional(),
        status: z
          .enum([
            'scheduled',
            'in_transit_to_external',
            'at_external',
            'returning',
            'completed',
            'overdue',
            'cancelled',
            'all',
          ])
          .default('all'),
      })
      .parse(input ?? {})
    const tenantId = session.logifit.tenantId
    const where = [eq2(equipmentMaintenance.tenantId, tenantId)]
    if (parsed.equipmentId) where.push(eq2(equipmentMaintenance.equipmentId, parsed.equipmentId))
    if (parsed.status !== 'all') where.push(eq2(equipmentMaintenance.status, parsed.status))
    const rows = await db
      .select({
        id: equipmentMaintenance.id,
        equipmentId: equipmentMaintenance.equipmentId,
        kind: equipmentMaintenance.kind,
        plannedFor: equipmentMaintenance.plannedFor,
        performedAt: equipmentMaintenance.performedAt,
        status: equipmentMaintenance.status,
        externalLocation: equipmentMaintenance.externalLocation,
        costCents: equipmentMaintenance.costCents,
        observations: equipmentMaintenance.observations,
        equipmentManufacturer: equipment.manufacturer,
        equipmentModel: equipment.model,
        equipmentSerialNumber: equipment.serialNumber,
      })
      .from(equipmentMaintenance)
      .leftJoin(equipment, eq2(equipment.id, equipmentMaintenance.equipmentId))
      .where(and(...where))
      .orderBy(asc(equipmentMaintenance.plannedFor))
      .limit(200)
    return { maintenances: rows }
  },
)

// ─── listAttentionMaintenances (overdue + D-7 + D-30) ──────────────────

export const listAttentionMaintenances = wrapServerAction(
  { module: 'vigilancia', action: 'maintenance.attention' },
  async (_input: undefined, { session }) => {
    const tenantId = session.logifit.tenantId
    const rows = await db
      .select({
        id: equipmentMaintenance.id,
        equipmentId: equipmentMaintenance.equipmentId,
        kind: equipmentMaintenance.kind,
        plannedFor: equipmentMaintenance.plannedFor,
        status: equipmentMaintenance.status,
        equipmentManufacturer: equipment.manufacturer,
        equipmentModel: equipment.model,
        equipmentSerialNumber: equipment.serialNumber,
      })
      .from(equipmentMaintenance)
      .leftJoin(equipment, eq2(equipment.id, equipmentMaintenance.equipmentId))
      .where(
        and(
          eq2(equipmentMaintenance.tenantId, tenantId),
          sql`${equipmentMaintenance.status} IN ('scheduled', 'overdue')`,
        ),
      )
      .orderBy(asc(equipmentMaintenance.plannedFor))
      .limit(500)

    const windows: MaintenanceWindow[] = rows.map((r) => ({
      equipmentId: r.equipmentId,
      plannedFor: r.plannedFor,
      kind: r.kind as 'preventive' | 'calibration' | 'corrective',
      status: r.status as MaintenanceWindow['status'],
    }))
    const checks = classifyMaintenances(windows)
    const attention = pickAttentionItems(checks)
    const attentionIds = new Set(attention.map((a) => `${a.equipmentId}-${a.plannedFor}`))
    return {
      attentions: rows
        .map((r, i) => ({
          ...r,
          urgency: checks[i]?.urgency,
          daysUntil: checks[i]?.daysUntil,
        }))
        .filter((r) => attentionIds.has(`${r.equipmentId}-${r.plannedFor}`)),
    }
  },
)

// ─── recordUsage ───────────────────────────────────────────────────────

export const recordUsage = wrapServerAction(
  { module: 'vigilancia', action: 'equipment.record_usage', resourceType: 'equipment_usage_log' },
  async (input: z.infer<typeof RecordUsageInputSchema>, { session, setAuditResource }) => {
    const parsed = RecordUsageInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .insert(equipmentUsageLog)
      .values({
        tenantId,
        equipmentId: parsed.equipmentId,
        appointmentId: parsed.appointmentId ?? null,
        usedByUserId: session.logifit.userId,
        durationMinutes: parsed.durationMinutes ?? null,
        parameters: parsed.parameters ?? null,
        notes: parsed.notes ?? null,
      })
      .returning({ id: equipmentUsageLog.id })
    setAuditResource(row!.id, { equipmentId: parsed.equipmentId })
    return { id: row!.id }
  },
)

// ─── cleaning ───────────────────────────────────────────────────────────

export const createCleaningChecklist = wrapServerAction(
  {
    module: 'vigilancia',
    action: 'cleaning.checklist_create',
    resourceType: 'cleaning_checklists',
  },
  async (input: z.infer<typeof CreateChecklistInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateChecklistInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .insert(cleaningChecklists)
      .values({
        tenantId,
        companyId: parsed.companyId,
        unitId: parsed.unitId ?? null,
        name: parsed.name,
        items: parsed.items as unknown as Record<string, unknown>,
        frequencyDays: parsed.frequencyDays,
        active: true,
      })
      .returning({ id: cleaningChecklists.id })
    setAuditResource(row!.id, { name: parsed.name })
    return { id: row!.id }
  },
)

export const listCleaningChecklists = wrapServerAction(
  { module: 'vigilancia', action: 'cleaning.checklist_list' },
  async (input: { companyId?: string } | undefined, { session }) => {
    const parsed = z.object({ companyId: z.string().uuid().optional() }).parse(input ?? {})
    const tenantId = session.logifit.tenantId
    const where = [eq2(cleaningChecklists.tenantId, tenantId), eq2(cleaningChecklists.active, true)]
    if (parsed.companyId) where.push(eq2(cleaningChecklists.companyId, parsed.companyId))
    const rows = await db
      .select()
      .from(cleaningChecklists)
      .where(and(...where))
      .orderBy(asc(cleaningChecklists.name))
    return { checklists: rows }
  },
)

export const recordCleaning = wrapServerAction(
  { module: 'vigilancia', action: 'cleaning.record', resourceType: 'cleaning_logs' },
  async (input: z.infer<typeof RecordCleaningInputSchema>, { session, setAuditResource }) => {
    const parsed = RecordCleaningInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [cl] = await db
      .select()
      .from(cleaningChecklists)
      .where(
        and(
          eq2(cleaningChecklists.id, parsed.checklistId),
          eq2(cleaningChecklists.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!cl)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Checklist não encontrado',
        request_id: '',
      })

    const items = (cl.items as unknown as ChecklistItem[]) ?? []
    const validation = validateChecklist({ items, itemsDone: parsed.itemsDone })

    const [row] = await db
      .insert(cleaningLogs)
      .values({
        tenantId,
        companyId: cl.companyId,
        unitId: cl.unitId,
        checklistId: parsed.checklistId,
        performedByUserId: session.logifit.userId,
        itemsDone: parsed.itemsDone as unknown as Record<string, unknown>,
        completionPct: validation.completionPct,
        isComplete: validation.isComplete,
        observations: parsed.observations ?? null,
      })
      .returning({ id: cleaningLogs.id })

    setAuditResource(row!.id, {
      completionPct: validation.completionPct,
      isComplete: validation.isComplete,
      missingRequired: validation.missingRequired,
    })
    return { id: row!.id, validation }
  },
)

export const listCleaningStatus = wrapServerAction(
  { module: 'vigilancia', action: 'cleaning.status' },
  async (input: { companyId?: string } | undefined, { session }) => {
    const parsed = z.object({ companyId: z.string().uuid().optional() }).parse(input ?? {})
    const tenantId = session.logifit.tenantId

    const checklists = await db
      .select({
        id: cleaningChecklists.id,
        name: cleaningChecklists.name,
        unitId: cleaningChecklists.unitId,
        frequencyDays: cleaningChecklists.frequencyDays,
      })
      .from(cleaningChecklists)
      .where(
        and(
          eq2(cleaningChecklists.tenantId, tenantId),
          eq2(cleaningChecklists.active, true),
          parsed.companyId ? eq2(cleaningChecklists.companyId, parsed.companyId) : sql`true`,
        ),
      )
      .limit(200)

    const result = []
    for (const c of checklists) {
      const [lastLog] = await db
        .select({ performedAt: cleaningLogs.performedAt })
        .from(cleaningLogs)
        .where(
          and(
            eq2(cleaningLogs.tenantId, tenantId),
            eq2(cleaningLogs.checklistId, c.id),
            eq2(cleaningLogs.isComplete, true),
          ),
        )
        .orderBy(desc(cleaningLogs.performedAt))
        .limit(1)
      const status = checkCleaningStatus({
        checklistId: c.id,
        unitId: c.unitId,
        frequencyDays: c.frequencyDays,
        lastPerformedAt: lastLog?.performedAt?.toISOString() ?? null,
      })
      result.push({ ...c, ...status })
    }
    return { statuses: result }
  },
)

// ─── validateCnesCodeAction (helper UI) ─────────────────────────────────

export const validateCnesCodeAction = wrapServerAction(
  { module: 'vigilancia', action: 'cnes.validate' },
  async (input: z.infer<typeof ValidateCnesInputSchema>, { session: _session }) => {
    const parsed = ValidateCnesInputSchema.parse(input)
    const validation = validateCnesCode(parsed.code)
    return validation
  },
)

// Drizzle helper renomeado para evitar shadow do schema `equipment`
import { eq as eq2 } from 'drizzle-orm'

void isNull
