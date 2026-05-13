'use server'

import { db } from '@repo/db/client'
import { appointmentWaitlist, appointments, members, resources } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
/**
 * Server Actions de `agenda` — Sprint 03 Faixa B (ADR 0012 esperado).
 *
 * **EXCLUDE constraint** em appointments (Sprint 03 Faixa A) garante que
 * 2 booking ativos sobrepostos no mesmo resource são bloqueados pelo
 * Postgres. SQLSTATE `23P01` (exclusion_violation) → mapeado pra `CONFLICT`.
 *
 * Recurring slots (FREQ=WEEKLY RRULE) ficam em Faixa C — primeiro entregar
 * appointment direto (ad-hoc) cobrindo 80% dos casos MVP. Stretch Sprint 03
 * adiciona expansão lazy.
 */
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod schemas ──────────────────────────────────────────────────────

const ResourceKindSchema = z.enum(['instrutor', 'sala', 'equipamento'])
const AppointmentStatusSchema = z.enum([
  'booked',
  'checked_in',
  'cancelled',
  'no_show',
  'completed',
])

const CreateResourceInputSchema = z.object({
  companyId: z.string().uuid(),
  unitId: z.string().uuid().nullable().optional(),
  kind: ResourceKindSchema,
  name: z.string().trim().min(2).max(120),
  modality: z.string().trim().max(40).nullable().optional(),
  instructorUserId: z.string().uuid().nullable().optional(),
})

const ListResourcesInputSchema = z.object({
  companyId: z.string().uuid().optional(),
  kind: ResourceKindSchema.optional(),
  includeArchived: z.boolean().optional().default(false),
  limit: z.number().int().positive().max(200).optional().default(100),
})

const ArchiveResourceInputSchema = z.object({
  resourceId: z.string().uuid(),
})

const CreateAppointmentInputSchema = z
  .object({
    resourceId: z.string().uuid(),
    memberId: z.string().uuid(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    recurringSlotId: z.string().uuid().nullable().optional(),
  })
  .refine((data) => new Date(data.startsAt) < new Date(data.endsAt), {
    message: 'starts_at deve ser anterior a ends_at',
    path: ['endsAt'],
  })

const CancelAppointmentInputSchema = z.object({
  appointmentId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
})

const CheckInAppointmentInputSchema = z.object({
  appointmentId: z.string().uuid(),
})

const ListAppointmentsInputSchema = z.object({
  resourceId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  status: AppointmentStatusSchema.optional(),
})

// ─── createResource ────────────────────────────────────────────────────

export const createResource = wrapServerAction(
  { module: 'agenda', action: 'resource.create' },
  async (input: z.infer<typeof CreateResourceInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateResourceInputSchema.parse(input)
    const [row] = await db
      .insert(resources)
      .values({
        tenantId: session.logifit.tenantId,
        companyId: parsed.companyId,
        unitId: parsed.unitId ?? null,
        kind: parsed.kind,
        name: parsed.name,
        modality: parsed.modality ?? null,
        instructorUserId: parsed.instructorUserId ?? null,
      })
      .returning({ id: resources.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar recurso',
        request_id: '',
      })
    setAuditResource(row.id, { kind: parsed.kind, name: parsed.name })
    return { id: row.id }
  },
)

// ─── listResources ─────────────────────────────────────────────────────

export const listResources = wrapServerAction(
  { module: 'agenda', action: 'resource.list' },
  async (input: z.infer<typeof ListResourcesInputSchema>, { session }) => {
    const parsed = ListResourcesInputSchema.parse(input)
    const conditions = [eq(resources.tenantId, session.logifit.tenantId)]
    if (parsed.companyId) conditions.push(eq(resources.companyId, parsed.companyId))
    if (parsed.kind) conditions.push(eq(resources.kind, parsed.kind))
    if (!parsed.includeArchived) conditions.push(isNull(resources.archivedAt))

    const rows = await db
      .select({
        id: resources.id,
        companyId: resources.companyId,
        unitId: resources.unitId,
        kind: resources.kind,
        name: resources.name,
        modality: resources.modality,
        instructorUserId: resources.instructorUserId,
        archivedAt: resources.archivedAt,
      })
      .from(resources)
      .where(and(...conditions))
      .orderBy(asc(resources.name))
      .limit(parsed.limit)
    return { resources: rows }
  },
)

// ─── archiveResource ───────────────────────────────────────────────────

export const archiveResource = wrapServerAction(
  { module: 'agenda', action: 'resource.archive' },
  async (input: z.infer<typeof ArchiveResourceInputSchema>, { session, setAuditResource }) => {
    const parsed = ArchiveResourceInputSchema.parse(input)
    const [row] = await db
      .update(resources)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(resources.id, parsed.resourceId), eq(resources.tenantId, session.logifit.tenantId)),
      )
      .returning({ id: resources.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Recurso não encontrado',
        request_id: '',
      })
    setAuditResource(row.id)
    return { id: row.id }
  },
)

// ─── createAppointment ─────────────────────────────────────────────────
//
// EXCLUDE constraint (Sprint 03 Faixa A) bloqueia overlap pra status ativos.
// SQLSTATE 23P01 → mapeia pra CONFLICT user-friendly ("horário já reservado").

export const createAppointment = wrapServerAction(
  { module: 'agenda', action: 'appointment.create' },
  async (input: z.infer<typeof CreateAppointmentInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateAppointmentInputSchema.parse(input)

    // Valida que member pertence ao tenant (defesa em profundidade — RLS já filtra)
    const [memberRow] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, parsed.memberId), eq(members.tenantId, session.logifit.tenantId)))
      .limit(1)
    if (!memberRow)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })

    try {
      const [row] = await db
        .insert(appointments)
        .values({
          tenantId: session.logifit.tenantId,
          resourceId: parsed.resourceId,
          memberId: parsed.memberId,
          recurringSlotId: parsed.recurringSlotId ?? null,
          startsAt: new Date(parsed.startsAt),
          endsAt: new Date(parsed.endsAt),
          status: 'booked',
          createdByUserId: session.logifit.userId,
        })
        .returning({ id: appointments.id })
      if (!row)
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'Falha ao criar agendamento',
          request_id: '',
        })
      setAuditResource(row.id, {
        resourceId: parsed.resourceId,
        memberId: parsed.memberId,
        startsAt: parsed.startsAt,
      })
      return { id: row.id }
    } catch (err) {
      // EXCLUDE constraint = horário já reservado
      if ((err as { code?: string }).code === '23P01') {
        throw new ApiException({
          code: 'CONFLICT',
          message: 'Horário já reservado para esse recurso',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── cancelAppointment ─────────────────────────────────────────────────
//
// Cancela + promove primeiro da waitlist (se houver e veio de recurring_slot).
// Operação em transação pra evitar promover sem cancelar.

export const cancelAppointment = wrapServerAction(
  { module: 'agenda', action: 'appointment.cancel' },
  async (input: z.infer<typeof CancelAppointmentInputSchema>, { session, setAuditResource }) => {
    const parsed = CancelAppointmentInputSchema.parse(input)

    return await db.transaction(async (tx) => {
      const [appt] = await tx
        .select({
          id: appointments.id,
          recurringSlotId: appointments.recurringSlotId,
          startsAt: appointments.startsAt,
          endsAt: appointments.endsAt,
          resourceId: appointments.resourceId,
          status: appointments.status,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.id, parsed.appointmentId),
            eq(appointments.tenantId, session.logifit.tenantId),
          ),
        )
        .limit(1)
      if (!appt)
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Agendamento não encontrado',
          request_id: '',
        })
      if (appt.status === 'cancelled') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Agendamento já cancelado',
          request_id: '',
        })
      }
      if (appt.status === 'completed') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Agendamento já concluído — não pode cancelar',
          request_id: '',
        })
      }

      // Marca como cancelled — libera horário no EXCLUDE filter
      await tx
        .update(appointments)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledReason: parsed.reason ?? null,
          cancelledByUserId: session.logifit.userId,
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, parsed.appointmentId))

      // Promover primeiro da waitlist se veio de recurring_slot
      let promotedAppointmentId: string | null = null
      if (appt.recurringSlotId) {
        const [next] = await tx
          .select({
            id: appointmentWaitlist.id,
            memberId: appointmentWaitlist.memberId,
          })
          .from(appointmentWaitlist)
          .where(
            and(
              eq(appointmentWaitlist.recurringSlotId, appt.recurringSlotId),
              eq(appointmentWaitlist.startsAt, appt.startsAt),
              eq(appointmentWaitlist.tenantId, session.logifit.tenantId),
            ),
          )
          .orderBy(asc(appointmentWaitlist.createdAt))
          .limit(1)
        if (next) {
          const [created] = await tx
            .insert(appointments)
            .values({
              tenantId: session.logifit.tenantId,
              resourceId: appt.resourceId,
              memberId: next.memberId,
              recurringSlotId: appt.recurringSlotId,
              startsAt: appt.startsAt,
              endsAt: appt.endsAt,
              status: 'booked',
              createdByUserId: session.logifit.userId,
            })
            .returning({ id: appointments.id })
          promotedAppointmentId = created?.id ?? null
          await tx.delete(appointmentWaitlist).where(eq(appointmentWaitlist.id, next.id))
        }
      }

      setAuditResource(parsed.appointmentId, {
        reason: parsed.reason,
        promotedAppointmentId,
      })
      return { id: parsed.appointmentId, promotedAppointmentId }
    })
  },
)

// ─── checkInAppointment ────────────────────────────────────────────────

export const checkInAppointment = wrapServerAction(
  { module: 'agenda', action: 'appointment.check_in' },
  async (input: z.infer<typeof CheckInAppointmentInputSchema>, { session, setAuditResource }) => {
    const parsed = CheckInAppointmentInputSchema.parse(input)
    const [row] = await db
      .update(appointments)
      .set({
        status: 'checked_in',
        checkedInAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appointments.id, parsed.appointmentId),
          eq(appointments.tenantId, session.logifit.tenantId),
          eq(appointments.status, 'booked'),
        ),
      )
      .returning({ id: appointments.id })
    if (!row) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Agendamento não encontrado ou não está em status "booked"',
        request_id: '',
      })
    }
    setAuditResource(row.id)
    return { id: row.id }
  },
)

// ─── getAppointment ────────────────────────────────────────────────────

const GetAppointmentInputSchema = z.object({ appointmentId: z.string().uuid() })

export const getAppointment = wrapServerAction(
  { module: 'agenda', action: 'appointment.read' },
  async (input: z.infer<typeof GetAppointmentInputSchema>, { session }) => {
    const parsed = GetAppointmentInputSchema.parse(input)
    const [row] = await db
      .select({
        id: appointments.id,
        resourceId: appointments.resourceId,
        memberId: appointments.memberId,
        recurringSlotId: appointments.recurringSlotId,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        cancelledAt: appointments.cancelledAt,
        cancelledReason: appointments.cancelledReason,
        cancelledByUserId: appointments.cancelledByUserId,
        checkedInAt: appointments.checkedInAt,
        createdByUserId: appointments.createdByUserId,
        createdAt: appointments.createdAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.id, parsed.appointmentId),
          eq(appointments.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Agendamento não encontrado',
        request_id: '',
      })
    return row
  },
)

// ─── listAppointments ──────────────────────────────────────────────────

export const listAppointments = wrapServerAction(
  { module: 'agenda', action: 'appointment.list' },
  async (input: z.infer<typeof ListAppointmentsInputSchema>, { session }) => {
    const parsed = ListAppointmentsInputSchema.parse(input)
    const conditions = [
      eq(appointments.tenantId, session.logifit.tenantId),
      gte(appointments.startsAt, new Date(parsed.from)),
      lte(appointments.startsAt, new Date(parsed.to)),
    ]
    if (parsed.resourceId) conditions.push(eq(appointments.resourceId, parsed.resourceId))
    if (parsed.memberId) conditions.push(eq(appointments.memberId, parsed.memberId))
    if (parsed.status) conditions.push(eq(appointments.status, parsed.status))

    const rows = await db
      .select({
        id: appointments.id,
        resourceId: appointments.resourceId,
        memberId: appointments.memberId,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        cancelledAt: appointments.cancelledAt,
        checkedInAt: appointments.checkedInAt,
      })
      .from(appointments)
      .where(and(...conditions))
      .orderBy(asc(appointments.startsAt))
      .limit(500)
    return { appointments: rows }
  },
)

// ─── listMemberAgenda ──────────────────────────────────────────────────
// Sprint 03 Faixa D — widget agenda no perfil do member (Sprint 02 slot).
// Retorna próximos N appointments + ocupação histórica resumida.

const ListMemberAgendaInputSchema = z.object({
  memberId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(10),
})

export const listMemberAgenda = wrapServerAction(
  { module: 'agenda', action: 'appointment.list_by_member' },
  async (input: z.infer<typeof ListMemberAgendaInputSchema>, { session }) => {
    const parsed = ListMemberAgendaInputSchema.parse(input)

    // Próximos N (status booked/checked_in, futuro)
    const upcoming = await db
      .select({
        id: appointments.id,
        resourceId: appointments.resourceId,
        resourceName: resources.name,
        resourceKind: resources.kind,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
      })
      .from(appointments)
      .innerJoin(resources, eq(resources.id, appointments.resourceId))
      .where(
        and(
          eq(appointments.tenantId, session.logifit.tenantId),
          eq(appointments.memberId, parsed.memberId),
          gte(appointments.startsAt, new Date()),
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(parsed.limit)

    return { upcoming }
  },
)
