'use server'

/**
 * Server Actions de avaliações físicas — Sprint 12 Faixa B (ADR 0024 esperado).
 *
 * MVP:
 *   - createAssessmentType (custom no tenant; biblioteca global via curador externo)
 *   - listAssessmentTypes (combina global + tenant; filtros category/vertical)
 *   - createAssessment (transação: assessment + measurements + calculations)
 *   - listMemberAssessments (lista + counts)
 *   - getAssessment (com measurements + photos + calculations expandidos)
 *   - compareAssessments (lado-a-lado pra gráfico evolução)
 *   - softDeleteAssessment (preserva row + audit; retenção 20a)
 *
 * Cálculos automáticos em `createAssessment`: chama @repo/db/avaliacoes/calc
 * baseado em `field_key` reconhecidos (peso_kg + altura_cm → IMC;
 * dobras_7 + idade + sexo → Pollock; cintura + quadril → RCQ; etc).
 *
 * Regras consumidas:
 *   - regra 7 (Zod validation boundary)
 *   - regra 29 (dado de saúde — leitura audited via wrapServerAction)
 *   - regra 33 (envelope ADR 0071)
 *   - regra 41 (ai-blocked em createAssessment com dados clínicos — Nível 4-5)
 */

import {
  calculateImc,
  calculateLeanMass,
  calculatePollock7,
  calculateRcq,
  calculateTmbMifflin,
} from '@repo/db/avaliacoes'
import { db } from '@repo/db/client'
import {
  assessmentCalculations,
  assessmentMeasurements,
  assessmentTypes,
  assessments,
  members,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const FieldDefSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  kind: z.enum(['number', 'text', 'enum', 'likert']),
  unit: z.string().max(20).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string()).optional(),
  weight: z.number().optional(),
})

const CreateAssessmentTypeInputSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  category: z.enum([
    'composicao_corporal',
    'escala_funcional',
    'anamnese',
    'teste_funcional',
    'custom',
  ]),
  vertical: z.enum(['academia', 'fisio', 'nutri']).optional(),
  fields: z.array(FieldDefSchema).min(1).max(50),
  scoringMethod: z.record(z.unknown()).optional(),
  clinicalReference: z.string().max(300).optional(),
})

const ListAssessmentTypesInputSchema = z.object({
  category: z
    .enum(['composicao_corporal', 'escala_funcional', 'anamnese', 'teste_funcional', 'custom'])
    .optional(),
  vertical: z.enum(['academia', 'fisio', 'nutri']).optional(),
  includeGlobal: z.boolean().default(true),
})

const MeasurementInputSchema = z
  .object({
    fieldKey: z.string().min(1).max(60),
    valueNum: z.number().optional(),
    valueText: z.string().max(2000).optional(),
    valueEnum: z.string().max(120).optional(),
  })
  .refine(
    (v) => v.valueNum !== undefined || !!v.valueText || !!v.valueEnum,
    'Pelo menos 1 de valueNum/valueText/valueEnum obrigatório',
  )

const CreateAssessmentInputSchema = z.object({
  memberId: z.string().uuid(),
  assessmentTypeId: z.string().uuid(),
  performedAt: z.string().datetime(),
  notes: z.string().max(2000).optional(),
  measurements: z.array(MeasurementInputSchema).min(1).max(100),
  /** Contexto opcional pra cálculos derivados (idade, sexo do member) */
  context: z
    .object({
      ageYears: z.number().int().min(1).max(120).optional(),
      sex: z.enum(['male', 'female']).optional(),
      heightCm: z.number().positive().max(300).optional(),
    })
    .optional(),
})

const ListMemberAssessmentsInputSchema = z.object({
  memberId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(20),
  category: z
    .enum(['composicao_corporal', 'escala_funcional', 'anamnese', 'teste_funcional', 'custom'])
    .optional(),
})

const GetAssessmentInputSchema = z.object({
  assessmentId: z.string().uuid(),
})

const CompareAssessmentsInputSchema = z.object({
  memberId: z.string().uuid(),
  fieldKey: z.string().min(1).max(60),
  limit: z.number().int().min(2).max(50).default(10),
})

const SoftDeleteAssessmentInputSchema = z.object({
  assessmentId: z.string().uuid(),
  reason: z.string().min(2).max(500),
})

// ─── createAssessmentType ────────────────────────────────────────────────

export const createAssessmentType = wrapServerAction(
  {
    module: 'avaliacoes',
    action: 'assessment_type.create',
    resourceType: 'assessment_types',
  },
  async (
    input: z.infer<typeof CreateAssessmentTypeInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = CreateAssessmentTypeInputSchema.parse(input)
    const [row] = await db
      .insert(assessmentTypes)
      .values({
        tenantId: session.logifit.tenantId,
        name: parsed.name,
        description: parsed.description ?? null,
        category: parsed.category,
        vertical: parsed.vertical ?? null,
        fields: parsed.fields,
        scoringMethod: parsed.scoringMethod ?? null,
        clinicalReference: parsed.clinicalReference ?? null,
        version: 1,
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: assessmentTypes.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar tipo',
        request_id: '',
      })
    setAuditResource(row.id, { name: parsed.name, category: parsed.category })
    return { id: row.id }
  },
)

// ─── listAssessmentTypes ─────────────────────────────────────────────────

export const listAssessmentTypes = wrapServerAction(
  { module: 'avaliacoes', action: 'assessment_type.list' },
  async (
    input: z.infer<typeof ListAssessmentTypesInputSchema>,
    { session },
  ) => {
    const parsed = ListAssessmentTypesInputSchema.parse(input)
    const tenantFilter = parsed.includeGlobal
      ? or(
          eq(assessmentTypes.tenantId, session.logifit.tenantId),
          isNull(assessmentTypes.tenantId),
        )
      : eq(assessmentTypes.tenantId, session.logifit.tenantId)

    const conditions = [
      tenantFilter,
      eq(assessmentTypes.active, true),
      isNull(assessmentTypes.archivedAt),
    ]
    if (parsed.category) conditions.push(eq(assessmentTypes.category, parsed.category))
    if (parsed.vertical) conditions.push(eq(assessmentTypes.vertical, parsed.vertical))

    const rows = await db
      .select({
        id: assessmentTypes.id,
        tenantId: assessmentTypes.tenantId,
        name: assessmentTypes.name,
        description: assessmentTypes.description,
        category: assessmentTypes.category,
        vertical: assessmentTypes.vertical,
        fields: assessmentTypes.fields,
        clinicalReference: assessmentTypes.clinicalReference,
        version: assessmentTypes.version,
      })
      .from(assessmentTypes)
      .where(and(...conditions))
      .orderBy(asc(assessmentTypes.name))

    return { rows: rows.map((r) => ({ ...r, isGlobal: r.tenantId === null })) }
  },
)

// ─── createAssessment (com cálculos automáticos) ─────────────────────────
/**
 * Transação: cria assessment + measurements + calculations (IMC se peso+altura,
 * Pollock se 7 dobras + idade + sexo, RCQ se cintura+quadril, TMB se completo).
 */
export const createAssessment = wrapServerAction(
  { module: 'avaliacoes', action: 'assessment.create', resourceType: 'assessments' },
  async (
    input: z.infer<typeof CreateAssessmentInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = CreateAssessmentInputSchema.parse(input)

    // Sanity: member + type pertencem ao tenant (type pode ser global)
    const [m] = await db
      .select({ id: members.id })
      .from(members)
      .where(
        and(eq(members.id, parsed.memberId), eq(members.tenantId, session.logifit.tenantId)),
      )
      .limit(1)
    if (!m)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })

    const [t] = await db
      .select({ id: assessmentTypes.id, version: assessmentTypes.version })
      .from(assessmentTypes)
      .where(
        and(
          eq(assessmentTypes.id, parsed.assessmentTypeId),
          or(
            eq(assessmentTypes.tenantId, session.logifit.tenantId),
            isNull(assessmentTypes.tenantId),
          ),
          eq(assessmentTypes.active, true),
        ),
      )
      .limit(1)
    if (!t)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Tipo de avaliação não encontrado',
        request_id: '',
      })

    return await db.transaction(async (tx) => {
      const [a] = await tx
        .insert(assessments)
        .values({
          tenantId: session.logifit.tenantId,
          memberId: parsed.memberId,
          assessmentTypeId: parsed.assessmentTypeId,
          typeVersion: t.version,
          performedAt: new Date(parsed.performedAt),
          performedByUserId: session.logifit.userId,
          notes: parsed.notes ?? null,
        })
        .returning({ id: assessments.id })
      if (!a)
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'Falha ao criar avaliação',
          request_id: '',
        })

      // Measurements em batch
      await tx.insert(assessmentMeasurements).values(
        parsed.measurements.map((meas) => ({
          tenantId: session.logifit.tenantId,
          assessmentId: a.id,
          fieldKey: meas.fieldKey,
          valueNum: meas.valueNum?.toString() ?? null,
          valueText: meas.valueText ?? null,
          valueEnum: meas.valueEnum ?? null,
          source: 'manual' as const,
        })),
      )

      // Lookup measurements por fieldKey pra cálculos automáticos
      const byKey = new Map<string, number>()
      for (const m of parsed.measurements) {
        if (m.valueNum !== undefined) byKey.set(m.fieldKey, m.valueNum)
      }

      const calcsToInsert: {
        tenantId: string
        assessmentId: string
        calcKey: string
        value: string
        classification: string | null
      }[] = []

      // IMC: peso_kg + altura_cm (ou context.heightCm)
      const peso = byKey.get('peso_kg')
      const altura = byKey.get('altura_cm') ?? parsed.context?.heightCm
      if (peso && altura) {
        const imc = calculateImc({ weightKg: peso, heightCm: altura })
        if (imc) {
          calcsToInsert.push({
            tenantId: session.logifit.tenantId,
            assessmentId: a.id,
            calcKey: 'imc',
            value: imc.value.toString(),
            classification: imc.classification ?? null,
          })
        }
      }

      // RCQ: circ_cintura + circ_quadril
      const cintura = byKey.get('circ_cintura')
      const quadril = byKey.get('circ_quadril')
      if (cintura && quadril && parsed.context?.sex) {
        const rcq = calculateRcq({ waistCm: cintura, hipCm: quadril, sex: parsed.context.sex })
        if (rcq) {
          calcsToInsert.push({
            tenantId: session.logifit.tenantId,
            assessmentId: a.id,
            calcKey: 'rcq',
            value: rcq.value.toString(),
            classification: rcq.classification ?? null,
          })
        }
      }

      // Pollock 7 dobras: requer todas 7 + idade + sexo
      const dobras = {
        tricipital: byKey.get('dobra_tricipital'),
        subescapular: byKey.get('dobra_subescapular'),
        supraIliaca: byKey.get('dobra_supra_iliaca'),
        abdominal: byKey.get('dobra_abdominal'),
        peitoral: byKey.get('dobra_peitoral'),
        axilarMedia: byKey.get('dobra_axilar_media'),
        coxa: byKey.get('dobra_coxa'),
      }
      const hasDobras = Object.values(dobras).every((v) => v !== undefined)
      if (
        hasDobras &&
        parsed.context?.ageYears &&
        parsed.context?.sex
      ) {
        const poll = calculatePollock7({
          tricipital: dobras.tricipital!,
          subescapular: dobras.subescapular!,
          supraIliaca: dobras.supraIliaca!,
          abdominal: dobras.abdominal!,
          peitoral: dobras.peitoral!,
          axilarMedia: dobras.axilarMedia!,
          coxa: dobras.coxa!,
          ageYears: parsed.context.ageYears,
          sex: parsed.context.sex,
        })
        if (poll) {
          calcsToInsert.push({
            tenantId: session.logifit.tenantId,
            assessmentId: a.id,
            calcKey: 'pct_gordura_pollock7',
            value: poll.value.toString(),
            classification: poll.classification ?? null,
          })
          // Massa magra estimada
          if (peso) {
            const lbm = calculateLeanMass(peso, poll.value)
            if (lbm) {
              calcsToInsert.push({
                tenantId: session.logifit.tenantId,
                assessmentId: a.id,
                calcKey: 'massa_magra_kg',
                value: lbm.value.toString(),
                classification: null,
              })
            }
          }
        }
      }

      // TMB Mifflin: peso + altura + idade + sexo
      if (peso && altura && parsed.context?.ageYears && parsed.context?.sex) {
        const tmb = calculateTmbMifflin({
          weightKg: peso,
          heightCm: altura,
          ageYears: parsed.context.ageYears,
          sex: parsed.context.sex,
        })
        if (tmb) {
          calcsToInsert.push({
            tenantId: session.logifit.tenantId,
            assessmentId: a.id,
            calcKey: 'tmb_mifflin',
            value: tmb.value.toString(),
            classification: null,
          })
        }
      }

      if (calcsToInsert.length > 0) {
        await tx.insert(assessmentCalculations).values(calcsToInsert)
      }

      setAuditResource(a.id, {
        member_id: parsed.memberId,
        type_id: parsed.assessmentTypeId,
        measurements_count: parsed.measurements.length,
        calculations_count: calcsToInsert.length,
      })

      return {
        id: a.id,
        measurementsCount: parsed.measurements.length,
        calculationsCount: calcsToInsert.length,
      }
    })
  },
)

// ─── listMemberAssessments ───────────────────────────────────────────────

export const listMemberAssessments = wrapServerAction(
  { module: 'avaliacoes', action: 'assessment.list_by_member' },
  async (
    input: z.infer<typeof ListMemberAssessmentsInputSchema>,
    { session },
  ) => {
    const parsed = ListMemberAssessmentsInputSchema.parse(input)
    const conditions = [
      eq(assessments.tenantId, session.logifit.tenantId),
      eq(assessments.memberId, parsed.memberId),
      isNull(assessments.softDeletedAt),
    ]
    if (parsed.category) {
      conditions.push(eq(assessmentTypes.category, parsed.category))
    }
    const rows = await db
      .select({
        id: assessments.id,
        performedAt: assessments.performedAt,
        notes: assessments.notes,
        typeName: assessmentTypes.name,
        typeCategory: assessmentTypes.category,
        typeVertical: assessmentTypes.vertical,
      })
      .from(assessments)
      .leftJoin(assessmentTypes, eq(assessmentTypes.id, assessments.assessmentTypeId))
      .where(and(...conditions))
      .orderBy(desc(assessments.performedAt))
      .limit(parsed.limit)
    return { rows }
  },
)

// ─── getAssessment ───────────────────────────────────────────────────────

export const getAssessment = wrapServerAction(
  { module: 'avaliacoes', action: 'assessment.get', resourceType: 'assessments' },
  async (
    input: z.infer<typeof GetAssessmentInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = GetAssessmentInputSchema.parse(input)
    const [a] = await db
      .select({
        id: assessments.id,
        memberId: assessments.memberId,
        performedAt: assessments.performedAt,
        notes: assessments.notes,
        typeId: assessments.assessmentTypeId,
        typeVersion: assessments.typeVersion,
        softDeletedAt: assessments.softDeletedAt,
        typeName: assessmentTypes.name,
        typeCategory: assessmentTypes.category,
        typeFields: assessmentTypes.fields,
        typeClinicalRef: assessmentTypes.clinicalReference,
      })
      .from(assessments)
      .leftJoin(assessmentTypes, eq(assessmentTypes.id, assessments.assessmentTypeId))
      .where(
        and(
          eq(assessments.id, parsed.assessmentId),
          eq(assessments.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!a)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Avaliação não encontrada',
        request_id: '',
      })

    const measurements = await db
      .select({
        fieldKey: assessmentMeasurements.fieldKey,
        valueNum: assessmentMeasurements.valueNum,
        valueText: assessmentMeasurements.valueText,
        valueEnum: assessmentMeasurements.valueEnum,
        source: assessmentMeasurements.source,
      })
      .from(assessmentMeasurements)
      .where(eq(assessmentMeasurements.assessmentId, parsed.assessmentId))
      .orderBy(asc(assessmentMeasurements.fieldKey))

    const calculations = await db
      .select({
        calcKey: assessmentCalculations.calcKey,
        value: assessmentCalculations.value,
        classification: assessmentCalculations.classification,
        calculatedAt: assessmentCalculations.calculatedAt,
      })
      .from(assessmentCalculations)
      .where(eq(assessmentCalculations.assessmentId, parsed.assessmentId))

    setAuditResource(parsed.assessmentId, { member_id: a.memberId })
    return { assessment: a, measurements, calculations }
  },
)

// ─── compareAssessments (série temporal por field) ───────────────────────

export const compareAssessments = wrapServerAction(
  { module: 'avaliacoes', action: 'assessment.compare' },
  async (
    input: z.infer<typeof CompareAssessmentsInputSchema>,
    { session },
  ) => {
    const parsed = CompareAssessmentsInputSchema.parse(input)
    const rows = await db
      .select({
        performedAt: assessments.performedAt,
        valueNum: assessmentMeasurements.valueNum,
        valueText: assessmentMeasurements.valueText,
        valueEnum: assessmentMeasurements.valueEnum,
      })
      .from(assessmentMeasurements)
      .innerJoin(assessments, eq(assessments.id, assessmentMeasurements.assessmentId))
      .where(
        and(
          eq(assessments.tenantId, session.logifit.tenantId),
          eq(assessments.memberId, parsed.memberId),
          isNull(assessments.softDeletedAt),
          eq(assessmentMeasurements.fieldKey, parsed.fieldKey),
        ),
      )
      .orderBy(asc(assessments.performedAt))
      .limit(parsed.limit)

    return { rows }
  },
)

// ─── softDeleteAssessment ────────────────────────────────────────────────

export const softDeleteAssessment = wrapServerAction(
  { module: 'avaliacoes', action: 'assessment.soft_delete', resourceType: 'assessments' },
  async (
    input: z.infer<typeof SoftDeleteAssessmentInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = SoftDeleteAssessmentInputSchema.parse(input)
    const [row] = await db
      .update(assessments)
      .set({
        softDeletedAt: new Date(),
        softDeleteReason: parsed.reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(assessments.id, parsed.assessmentId),
          eq(assessments.tenantId, session.logifit.tenantId),
          isNull(assessments.softDeletedAt),
        ),
      )
      .returning({ id: assessments.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Avaliação não encontrada ou já apagada',
        request_id: '',
      })
    setAuditResource(row.id, { reason: parsed.reason })
    return { id: row.id }
  },
)

// ─── getLatestAssessmentSummary (widget perfil member) ───────────────────

const GetLatestSummaryInputSchema = z.object({
  memberId: z.string().uuid(),
})

export const getLatestAssessmentSummary = wrapServerAction(
  { module: 'avaliacoes', action: 'assessment.latest_summary' },
  async (
    input: z.infer<typeof GetLatestSummaryInputSchema>,
    { session },
  ) => {
    const parsed = GetLatestSummaryInputSchema.parse(input)
    const [latest] = await db
      .select({
        id: assessments.id,
        performedAt: assessments.performedAt,
        typeName: assessmentTypes.name,
      })
      .from(assessments)
      .leftJoin(assessmentTypes, eq(assessmentTypes.id, assessments.assessmentTypeId))
      .where(
        and(
          eq(assessments.tenantId, session.logifit.tenantId),
          eq(assessments.memberId, parsed.memberId),
          isNull(assessments.softDeletedAt),
        ),
      )
      .orderBy(desc(assessments.performedAt))
      .limit(1)
    if (!latest) return { latest: null, calculations: [] }

    const calcs = await db
      .select({
        calcKey: assessmentCalculations.calcKey,
        value: assessmentCalculations.value,
        classification: assessmentCalculations.classification,
      })
      .from(assessmentCalculations)
      .where(eq(assessmentCalculations.assessmentId, latest.id))

    return { latest, calculations: calcs }
  },
)
