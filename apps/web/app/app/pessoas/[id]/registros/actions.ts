'use server'

/**
 * Server Actions de professional_registrations — Sprint 01b D.2 (ADR 0055).
 *
 * Constraint global UNIQUE `(council_body, council_number, council_state)`
 * em TODA a rede LogiFit detecta fraude cross-tenant (mesmo profissional
 * cadastrado em 2 tenants com mesmo número).
 *
 * Trigger BEFORE INSERT verifica `kind=pf` (ADR 0047) — só pessoa física.
 */
import { db } from '@repo/db/client'
import { type ProfessionalRegistrationRow, professionalRegistrations } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../../lib/wrap-action'

// ─── listRegistrations ────────────────────────────────────────────────────
const listInputSchema = z.object({
  personId: z.string().uuid(),
})

export const listRegistrations = wrapServerAction(
  {
    module: 'persons.registrations',
    action: 'registration.list',
    resourceType: 'professional_registrations',
  },
  async (rawInput: z.input<typeof listInputSchema>): Promise<ProfessionalRegistrationRow[]> => {
    const input = listInputSchema.parse(rawInput)
    const rows = await db
      .select()
      .from(professionalRegistrations)
      .where(eq(professionalRegistrations.personId, input.personId))
      .orderBy(professionalRegistrations.councilBody)
    return rows
  },
)

// ─── createRegistration ───────────────────────────────────────────────────
const createInputSchema = z.object({
  personId: z.string().uuid(),
  councilBody: z.enum(['CRM', 'CRN', 'CREFITO', 'CREF', 'CRF', 'CRP', 'COREN', 'CRO']),
  councilNumber: z.string().trim().min(1).max(20),
  councilState: z
    .string()
    .trim()
    .length(2)
    .transform((s) => s.toUpperCase()),
  specialty: z.string().trim().max(100).optional(),
  cboCode: z.string().trim().max(10).optional(),
  issuedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

export const createRegistration = wrapServerAction(
  {
    module: 'persons.registrations',
    action: 'registration.create',
    resourceType: 'professional_registrations',
  },
  async (
    rawInput: z.input<typeof createInputSchema>,
    ctx,
  ): Promise<ProfessionalRegistrationRow> => {
    const input = createInputSchema.parse(rawInput)

    try {
      const [row] = await db
        .insert(professionalRegistrations)
        .values({
          tenantId: ctx.session.logifit.tenantId,
          personId: input.personId,
          councilBody: input.councilBody,
          councilNumber: input.councilNumber,
          councilState: input.councilState,
          specialty: input.specialty ?? null,
          cboCode: input.cboCode ?? null,
          issuedAt: input.issuedAt ?? null,
          validUntil: input.validUntil ?? null,
          situation: 'pending_verification', // default — admin atesta depois
          verificationSource: 'operator_attested',
        })
        .returning()
      if (!row) {
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'insert vazio',
          request_id: '',
        })
      }
      ctx.setAuditResource(row.id, {
        council: `${row.councilBody}-${row.councilState}/${row.councilNumber}`,
      })
      return row
    } catch (err) {
      if (err instanceof ApiException) throw err
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('professional_registrations_global_uq')) {
        throw new ApiException({
          code: 'CONFLICT',
          message: 'Este registro já existe em outro tenant — possível fraude. Contate suporte.',
          request_id: '',
        })
      }
      if (msg.includes('kind=pf')) {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Registro profissional só pode ser linkado a pessoa física',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── attestRegistration ───────────────────────────────────────────────────
const attestInputSchema = z.object({
  registrationId: z.string().uuid(),
})

export const attestRegistration = wrapServerAction(
  {
    module: 'persons.registrations',
    action: 'registration.attest',
    resourceType: 'professional_registrations',
  },
  async (
    rawInput: z.input<typeof attestInputSchema>,
    ctx,
  ): Promise<ProfessionalRegistrationRow> => {
    const input = attestInputSchema.parse(rawInput)

    const [row] = await db
      .update(professionalRegistrations)
      .set({
        situation: 'active',
        verifiedAt: new Date(),
        verifiedByUserId: ctx.session.logifit.userId,
        verificationSource: 'operator_attested',
        updatedAt: new Date(),
      })
      .where(eq(professionalRegistrations.id, input.registrationId))
      .returning()
    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Registro não encontrado',
        request_id: '',
      })
    }
    ctx.setAuditResource(row.id, { newSituation: 'active' })
    return row
  },
)

// ─── updateRegistrationSituation ─────────────────────────────────────────
const updateSituationInputSchema = z.object({
  registrationId: z.string().uuid(),
  newSituation: z.enum([
    'active',
    'suspended',
    'cassated',
    'expired',
    'pending_verification',
    'unknown',
  ]),
  reason: z.string().trim().max(500).optional(),
})

export const updateRegistrationSituation = wrapServerAction(
  {
    module: 'persons.registrations',
    action: 'registration.update_situation',
    resourceType: 'professional_registrations',
  },
  async (
    rawInput: z.input<typeof updateSituationInputSchema>,
    ctx,
  ): Promise<ProfessionalRegistrationRow> => {
    const input = updateSituationInputSchema.parse(rawInput)
    const [row] = await db
      .update(professionalRegistrations)
      .set({
        situation: input.newSituation,
        updatedAt: new Date(),
      })
      .where(eq(professionalRegistrations.id, input.registrationId))
      .returning()
    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Registro não encontrado',
        request_id: '',
      })
    }
    ctx.setAuditResource(row.id, {
      newSituation: input.newSituation,
      reason: input.reason,
    })
    return row
  },
)
