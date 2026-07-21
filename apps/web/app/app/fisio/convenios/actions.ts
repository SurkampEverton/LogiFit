'use server'

/**
 * Server Actions Convênios TISS — Sprint 22 Faixa B.2 (ADRs 0029/0030/0031).
 *
 * Cobertura MVP:
 *   - createInsurancePlan / listInsurancePlans
 *   - createInsuranceAgreement / listInsuranceAgreements / setProcedurePrice
 *   - addMemberInsurance / listMemberInsurances
 *   - requestAuthorization / approveAuthorization / denyAuthorization / listAuthorizations
 *   - generateGuide (run validateGuide ANTES; bloqueia se erro)
 *   - createBatch (agrega N guias ready)
 *   - processReturnXml (parse + cria glosas + atualiza guides)
 *   - fileGlosa (registra recurso manual)
 *
 * **MVP envio:** persiste XML em `billing_batches.xml`; envio real à operadora
 * (SOAP/HTTP) vira Sprint 22b com ADR 0042. UI mostra "Lote pronto, baixe o XML".
 *
 * **Gate ADR 0055** — `generateGuide` carrega `professional_registrations` do
 * profissional executante e bloqueia se faltar `cbo_code` ou conselho ativo.
 *
 * **Regra 43 (MFA recente):** cancelamento de guia enviada é high-risk —
 * Sprint 22b adiciona `requireRecentMfa()` quando wrapper expõe.
 */

import { db } from '@repo/db/client'
import {
  type GuideInput,
  type GuideItem,
  type ValidationIssue,
  generateBatchXml,
  generateGuideXml,
  parseReturnXml,
  validateGuide,
} from '@repo/db/convenios'
import {
  authorizations,
  billingBatches,
  billingGlosas,
  billingGuideItems,
  billingGuides,
  companies,
  insuranceAgreements,
  insurancePlans,
  insuranceProcedurePrices,
  memberInsurances,
  members,
  persons,
  professionalRegistrations,
  tussCatalog,
  users,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const CreateInsurancePlanInputSchema = z.object({
  name: z.string().min(2).max(120),
  ansCode: z.string().max(20).optional().nullable(),
  national: z.boolean().default(true),
})

const CreateAgreementInputSchema = z.object({
  companyId: z.string().uuid(),
  planId: z.string().uuid(),
  contractNumber: z.string().max(80).optional().nullable(),
  paymentTermDays: z.number().int().min(0).max(180).default(30),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const SetProcedurePriceInputSchema = z.object({
  agreementId: z.string().uuid(),
  tussCode: z.string().min(2).max(30),
  priceCents: z.number().int().min(0),
  patientCopayCents: z.number().int().min(0).optional().nullable(),
  authRequired: z.boolean().default(false),
  maxSessionsPerAuth: z.number().int().min(0).optional().nullable(),
})

const AddMemberInsuranceInputSchema = z.object({
  memberId: z.string().uuid(),
  planId: z.string().uuid(),
  cardNumber: z.string().min(2).max(60),
  category: z.string().max(60).optional().nullable(),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  holderName: z.string().max(120).optional().nullable(),
})

const RequestAuthorizationInputSchema = z.object({
  memberInsuranceId: z.string().uuid(),
  tussCode: z.string().min(2).max(30),
  quantityRequested: z.number().int().positive(),
})

const ApproveAuthorizationInputSchema = z.object({
  authorizationId: z.string().uuid(),
  quantityAuthorized: z.number().int().positive(),
  authorizationNumber: z.string().min(2).max(60),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const DenyAuthorizationInputSchema = z.object({
  authorizationId: z.string().uuid(),
  denialReason: z.string().min(2).max(500),
})

const GenerateGuideItemInputSchema = z.object({
  tussCode: z.string().min(2).max(30),
  quantity: z.number().int().positive(),
  /** YYYY-MM-DD */
  executionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  professionalUserId: z.string().uuid(),
})

const GenerateGuideInputSchema = z.object({
  memberInsuranceId: z.string().uuid(),
  kind: z.enum(['consulta', 'sp_sadt']),
  guideNumber: z.string().min(2).max(40),
  authorizationId: z.string().uuid().optional().nullable(),
  items: z.array(GenerateGuideItemInputSchema).min(1).max(50),
})

const CreateBatchInputSchema = z.object({
  agreementId: z.string().uuid(),
  guideIds: z.array(z.string().uuid()).min(1).max(500),
  batchNumber: z.string().min(2).max(40),
})

const ProcessReturnXmlInputSchema = z.object({
  xml: z.string().min(50).max(10_000_000),
})

const FileGlosaInputSchema = z.object({
  glosaId: z.string().uuid(),
  recursoBody: z.string().min(10).max(5000),
})

// ─── createInsurancePlan ─────────────────────────────────────────────────

export const createInsurancePlan = wrapServerAction(
  { module: 'fisio', action: 'convenio.plan_create', resourceType: 'insurance_plans' },
  async (input: z.infer<typeof CreateInsurancePlanInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateInsurancePlanInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .insert(insurancePlans)
      .values({
        tenantId,
        name: parsed.name,
        ansCode: parsed.ansCode ?? null,
        tissVersion: '4.01',
        national: parsed.national,
        active: true,
      })
      .returning({ id: insurancePlans.id })
    setAuditResource(row!.id, { name: parsed.name })
    return { id: row!.id }
  },
)

export const listInsurancePlans = wrapServerAction(
  { module: 'fisio', action: 'convenio.plan_list' },
  async (_input: undefined, { session }) => {
    const tenantId = session.logifit.tenantId
    const rows = await db
      .select()
      .from(insurancePlans)
      .where(sql`tenant_id IS NULL OR tenant_id = ${tenantId}`)
      .orderBy(asc(insurancePlans.name))
      .limit(200)
    return { plans: rows }
  },
)

// ─── createInsuranceAgreement ────────────────────────────────────────────

export const createInsuranceAgreement = wrapServerAction(
  {
    module: 'fisio',
    action: 'convenio.agreement_create',
    resourceType: 'insurance_agreements',
  },
  async (input: z.infer<typeof CreateAgreementInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateAgreementInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    try {
      const [row] = await db
        .insert(insuranceAgreements)
        .values({
          tenantId,
          companyId: parsed.companyId,
          planId: parsed.planId,
          contractNumber: parsed.contractNumber ?? null,
          paymentTermDays: parsed.paymentTermDays,
          effectiveFrom: parsed.effectiveFrom,
          active: true,
        })
        .returning({ id: insuranceAgreements.id })
      setAuditResource(row!.id, { planId: parsed.planId })
      return { id: row!.id }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Já existe acordo ativo entre essa company e esse plano',
          request_id: '',
        })
      }
      throw err
    }
  },
)

export const listInsuranceAgreements = wrapServerAction(
  { module: 'fisio', action: 'convenio.agreement_list' },
  async (_input: undefined, { session }) => {
    const tenantId = session.logifit.tenantId
    const rows = await db
      .select({
        id: insuranceAgreements.id,
        companyId: insuranceAgreements.companyId,
        planId: insuranceAgreements.planId,
        planName: insurancePlans.name,
        contractNumber: insuranceAgreements.contractNumber,
        paymentTermDays: insuranceAgreements.paymentTermDays,
        effectiveFrom: insuranceAgreements.effectiveFrom,
        active: insuranceAgreements.active,
      })
      .from(insuranceAgreements)
      .leftJoin(insurancePlans, eq(insurancePlans.id, insuranceAgreements.planId))
      .where(eq(insuranceAgreements.tenantId, tenantId))
      .orderBy(asc(insurancePlans.name))
    return { agreements: rows }
  },
)

export const setProcedurePrice = wrapServerAction(
  {
    module: 'fisio',
    action: 'convenio.procedure_price_set',
    resourceType: 'insurance_procedure_prices',
  },
  async (input: z.infer<typeof SetProcedurePriceInputSchema>, { session, setAuditResource }) => {
    const parsed = SetProcedurePriceInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    // Valida agreement do tenant
    const [a] = await db
      .select({ id: insuranceAgreements.id })
      .from(insuranceAgreements)
      .where(
        and(
          eq(insuranceAgreements.id, parsed.agreementId),
          eq(insuranceAgreements.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!a)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Acordo não encontrado',
        request_id: '',
      })

    // upsert
    await db
      .insert(insuranceProcedurePrices)
      .values({
        agreementId: parsed.agreementId,
        tussCode: parsed.tussCode,
        priceCents: parsed.priceCents,
        patientCopayCents: parsed.patientCopayCents ?? null,
        authRequired: parsed.authRequired,
        maxSessionsPerAuth: parsed.maxSessionsPerAuth ?? null,
      })
      .onConflictDoUpdate({
        target: [insuranceProcedurePrices.agreementId, insuranceProcedurePrices.tussCode],
        set: {
          priceCents: parsed.priceCents,
          patientCopayCents: parsed.patientCopayCents ?? null,
          authRequired: parsed.authRequired,
          maxSessionsPerAuth: parsed.maxSessionsPerAuth ?? null,
          updatedAt: new Date(),
        },
      })
    setAuditResource(parsed.agreementId, { tussCode: parsed.tussCode })
    return { ok: true }
  },
)

// ─── addMemberInsurance ─────────────────────────────────────────────────

export const addMemberInsurance = wrapServerAction(
  { module: 'fisio', action: 'convenio.member_insurance_add', resourceType: 'member_insurances' },
  async (input: z.infer<typeof AddMemberInsuranceInputSchema>, { session, setAuditResource }) => {
    const parsed = AddMemberInsuranceInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [member] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, parsed.memberId), eq(members.tenantId, tenantId)))
      .limit(1)
    if (!member)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })

    try {
      const [row] = await db
        .insert(memberInsurances)
        .values({
          tenantId,
          memberId: parsed.memberId,
          planId: parsed.planId,
          cardNumber: parsed.cardNumber,
          category: parsed.category ?? null,
          validUntil: parsed.validUntil ?? null,
          holderName: parsed.holderName ?? null,
          active: true,
        })
        .returning({ id: memberInsurances.id })
      setAuditResource(row!.id, { planId: parsed.planId })
      return { id: row!.id }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Carteirinha já cadastrada para esse member nesse plano',
          request_id: '',
        })
      }
      throw err
    }
  },
)

export const listMemberInsurances = wrapServerAction(
  { module: 'fisio', action: 'convenio.member_insurance_list' },
  async (input: { memberId: string }, { session }) => {
    const parsed = z.object({ memberId: z.string().uuid() }).parse(input)
    const tenantId = session.logifit.tenantId
    const rows = await db
      .select({
        id: memberInsurances.id,
        planId: memberInsurances.planId,
        planName: insurancePlans.name,
        cardNumber: memberInsurances.cardNumber,
        category: memberInsurances.category,
        validUntil: memberInsurances.validUntil,
        holderName: memberInsurances.holderName,
        active: memberInsurances.active,
      })
      .from(memberInsurances)
      .leftJoin(insurancePlans, eq(insurancePlans.id, memberInsurances.planId))
      .where(
        and(
          eq(memberInsurances.tenantId, tenantId),
          eq(memberInsurances.memberId, parsed.memberId),
        ),
      )
      .orderBy(asc(insurancePlans.name))
    return { memberInsurances: rows }
  },
)

// ─── requestAuthorization ───────────────────────────────────────────────

export const requestAuthorization = wrapServerAction(
  { module: 'fisio', action: 'convenio.auth_request', resourceType: 'authorizations' },
  async (input: z.infer<typeof RequestAuthorizationInputSchema>, { session, setAuditResource }) => {
    const parsed = RequestAuthorizationInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida que a carteirinha referenciada pertence ao tenant (FK sem constraint de tenant)
    const [mi] = await db
      .select({ id: memberInsurances.id })
      .from(memberInsurances)
      .where(
        and(
          eq(memberInsurances.id, parsed.memberInsuranceId),
          eq(memberInsurances.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!mi)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Carteirinha não encontrada',
        request_id: '',
      })

    const [row] = await db
      .insert(authorizations)
      .values({
        tenantId,
        memberInsuranceId: parsed.memberInsuranceId,
        tussCode: parsed.tussCode,
        quantityRequested: parsed.quantityRequested,
        status: 'pending',
        requestedByUserId: session.logifit.userId,
      })
      .returning({ id: authorizations.id })
    setAuditResource(row!.id, { tussCode: parsed.tussCode })
    return { id: row!.id }
  },
)

export const approveAuthorization = wrapServerAction(
  { module: 'fisio', action: 'convenio.auth_approve', resourceType: 'authorizations' },
  async (input: z.infer<typeof ApproveAuthorizationInputSchema>, { session, setAuditResource }) => {
    const parsed = ApproveAuthorizationInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .update(authorizations)
      .set({
        status: 'approved',
        quantityAuthorized: parsed.quantityAuthorized,
        authorizationNumber: parsed.authorizationNumber,
        validUntil: parsed.validUntil,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(authorizations.id, parsed.authorizationId), eq(authorizations.tenantId, tenantId)),
      )
      .returning({ id: authorizations.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Autorização não encontrada',
        request_id: '',
      })
    setAuditResource(row.id, { status: 'approved' })
    return { ok: true }
  },
)

export const denyAuthorization = wrapServerAction(
  { module: 'fisio', action: 'convenio.auth_deny', resourceType: 'authorizations' },
  async (input: z.infer<typeof DenyAuthorizationInputSchema>, { session, setAuditResource }) => {
    const parsed = DenyAuthorizationInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .update(authorizations)
      .set({
        status: 'denied',
        denialReason: parsed.denialReason,
        deniedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(authorizations.id, parsed.authorizationId), eq(authorizations.tenantId, tenantId)),
      )
      .returning({ id: authorizations.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Autorização não encontrada',
        request_id: '',
      })
    setAuditResource(row.id, { status: 'denied' })
    return { ok: true }
  },
)

export const listAuthorizations = wrapServerAction(
  { module: 'fisio', action: 'convenio.auth_list' },
  async (_input: undefined, { session }) => {
    const tenantId = session.logifit.tenantId
    const rows = await db
      .select({
        id: authorizations.id,
        memberInsuranceId: authorizations.memberInsuranceId,
        tussCode: authorizations.tussCode,
        quantityRequested: authorizations.quantityRequested,
        quantityAuthorized: authorizations.quantityAuthorized,
        quantityUsed: authorizations.quantityUsed,
        authorizationNumber: authorizations.authorizationNumber,
        status: authorizations.status,
        requestedAt: authorizations.requestedAt,
        approvedAt: authorizations.approvedAt,
        validUntil: authorizations.validUntil,
      })
      .from(authorizations)
      .where(eq(authorizations.tenantId, tenantId))
      .orderBy(desc(authorizations.requestedAt))
      .limit(200)
    return { authorizations: rows }
  },
)

// ─── generateGuide ───────────────────────────────────────────────────────

export const generateGuide = wrapServerAction(
  { module: 'fisio', action: 'convenio.guide_generate', resourceType: 'billing_guides' },
  async (input: z.infer<typeof GenerateGuideInputSchema>, { session, setAuditResource }) => {
    const parsed = GenerateGuideInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // 1. Carrega memberInsurance + plan + member
    const [mi] = await db
      .select({
        id: memberInsurances.id,
        memberId: memberInsurances.memberId,
        memberName: persons.name,
        planId: memberInsurances.planId,
        planName: insurancePlans.name,
        planAnsCode: insurancePlans.ansCode,
        cardNumber: memberInsurances.cardNumber,
        validUntil: memberInsurances.validUntil,
        category: memberInsurances.category,
        companyId: members.companyId,
      })
      .from(memberInsurances)
      .innerJoin(members, eq(members.id, memberInsurances.memberId))
      .innerJoin(insurancePlans, eq(insurancePlans.id, memberInsurances.planId))
      .leftJoin(persons, eq(persons.id, members.personId))
      .where(
        and(
          eq(memberInsurances.id, parsed.memberInsuranceId),
          eq(memberInsurances.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!mi)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Carteirinha não encontrada',
        request_id: '',
      })

    // 2. Carrega agreement + price para o primeiro tussCode (validator usa pra checar authRequired)
    const firstTuss = parsed.items[0]!.tussCode
    const [agreement] = await db
      .select({ id: insuranceAgreements.id, companyId: insuranceAgreements.companyId })
      .from(insuranceAgreements)
      .where(
        and(
          eq(insuranceAgreements.tenantId, tenantId),
          eq(insuranceAgreements.companyId, mi.companyId),
          eq(insuranceAgreements.planId, mi.planId),
          eq(insuranceAgreements.active, true),
        ),
      )
      .limit(1)
    const [procPrice] = agreement
      ? await db
          .select({
            priceCents: insuranceProcedurePrices.priceCents,
            patientCopayCents: insuranceProcedurePrices.patientCopayCents,
            authRequired: insuranceProcedurePrices.authRequired,
            maxSessionsPerAuth: insuranceProcedurePrices.maxSessionsPerAuth,
          })
          .from(insuranceProcedurePrices)
          .where(
            and(
              eq(insuranceProcedurePrices.agreementId, agreement.id),
              eq(insuranceProcedurePrices.tussCode, firstTuss),
            ),
          )
          .limit(1)
      : [undefined]

    // 3. Carrega autorização opcional
    const [auth] = parsed.authorizationId
      ? await db
          .select({
            authorizationNumber: authorizations.authorizationNumber,
            quantityAuthorized: authorizations.quantityAuthorized,
            quantityUsed: authorizations.quantityUsed,
            validUntil: authorizations.validUntil,
            status: authorizations.status,
          })
          .from(authorizations)
          .where(
            and(
              eq(authorizations.id, parsed.authorizationId),
              eq(authorizations.tenantId, tenantId),
            ),
          )
          .limit(1)
      : [undefined]

    // 4. Carrega profissional do primeiro item via professional_registrations (ADR 0055)
    const firstItem = parsed.items[0]!
    const [profUser] = await db
      .select({ id: users.id, personId: users.personId, username: users.username })
      .from(users)
      .where(and(eq(users.id, firstItem.professionalUserId), eq(users.tenantId, tenantId)))
      .limit(1)
    if (!profUser)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Profissional executante não encontrado no tenant',
        request_id: '',
      })

    const [profPerson] = await db
      .select({ name: persons.name })
      .from(persons)
      .where(eq(persons.id, profUser.personId))
      .limit(1)

    const profRegs = await db
      .select({
        councilBody: professionalRegistrations.councilBody,
        councilState: professionalRegistrations.councilState,
        councilNumber: professionalRegistrations.councilNumber,
        cboCode: professionalRegistrations.cboCode,
        situation: professionalRegistrations.situation,
        specialty: professionalRegistrations.specialty,
      })
      .from(professionalRegistrations)
      .where(
        and(
          eq(professionalRegistrations.tenantId, tenantId),
          eq(professionalRegistrations.personId, profUser.personId),
        ),
      )
    const activeReg = profRegs.find((r) => r.situation === 'active') ?? null

    // 5. Carrega TUSS specialties pra validador
    const tussRows = await db
      .select({ specialties: tussCatalog.specialties })
      .from(tussCatalog)
      .where(eq(tussCatalog.code, firstTuss))
      .limit(1)
    const tussSpecialties = tussRows[0]?.specialties ?? null

    // 6. Calcula totalCents
    const calcItems = parsed.items.map((it) => {
      const unit = procPrice?.priceCents ?? 0
      const total = unit * it.quantity
      return {
        ...it,
        unitPriceCents: unit,
        totalCents: total,
      }
    })
    const totalCents = calcItems.reduce((s, it) => s + it.totalCents, 0)

    // 7. Roda validador proativo
    const validation = validateGuide({
      kind: parsed.kind,
      professional: {
        name: profPerson?.name ?? profUser.username,
        councilBody: activeReg?.councilBody ?? null,
        councilState: activeReg?.councilState ?? null,
        councilNumber: activeReg?.councilNumber ?? null,
        cbosCode: activeReg?.cboCode ?? null,
        specialty: activeReg?.specialty ?? null,
      },
      memberInsurance: {
        cardNumber: mi.cardNumber,
        validUntil: mi.validUntil,
      },
      authorization: auth
        ? {
            authorizationNumber: auth.authorizationNumber,
            quantityAuthorized: auth.quantityAuthorized,
            quantityUsed: auth.quantityUsed,
            validUntil: auth.validUntil,
            status: auth.status,
          }
        : null,
      procedurePrice: procPrice
        ? {
            authRequired: procPrice.authRequired,
            priceCents: procPrice.priceCents,
            patientCopayCents: procPrice.patientCopayCents,
            maxSessionsPerAuth: procPrice.maxSessionsPerAuth,
          }
        : null,
      tussSpecialties,
      items: calcItems.map((it) => ({
        tussCode: it.tussCode,
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        totalCents: it.totalCents,
        executionDate: it.executionDate,
      })),
      totalCents,
      expectedSpecialtyByKind: { sp_sadt: 'fisioterapia' },
    })

    if (!validation.ok) {
      const errors = validation.issues.filter((i: ValidationIssue) => i.severity === 'error')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Validador TISS bloqueou geração: ${errors.map((e) => e.message).join(' | ')}`,
        request_id: '',
      })
    }

    // 8. Carrega descrição TUSS pra cada item
    const tussCodes = calcItems.map((it) => it.tussCode)
    const tussDescriptions = await db
      .select({ code: tussCatalog.code, description: tussCatalog.description })
      .from(tussCatalog)
      .where(inArray(tussCatalog.code, tussCodes))
    const descByCode = new Map(tussDescriptions.map((t) => [t.code, t.description]))

    // 9. Gera XML
    const guideItems: GuideItem[] = calcItems.map((it, idx) => ({
      sequenceNumber: idx + 1,
      tussCode: it.tussCode,
      description: descByCode.get(it.tussCode) ?? it.tussCode,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      totalCents: it.totalCents,
      executionDate: it.executionDate,
      professional: {
        name: profPerson?.name ?? profUser.username,
        councilBody: activeReg!.councilBody,
        councilState: activeReg!.councilState!,
        councilNumber: activeReg!.councilNumber,
        cbosCode: activeReg!.cboCode!,
      },
    }))

    // Carrega CNPJ + nome da company
    const [company] = await db
      .select({ id: companies.id, name: persons.name, cnpj: persons.document })
      .from(companies)
      .leftJoin(persons, eq(persons.id, companies.personId))
      .where(and(eq(companies.id, mi.companyId), eq(companies.tenantId, tenantId)))
      .limit(1)

    const guideInput: GuideInput = {
      tissVersion: '4.01',
      kind: parsed.kind,
      guideNumber: parsed.guideNumber,
      operator: { ansCode: mi.planAnsCode ?? '', name: mi.planName },
      prestador: {
        cnpj: company?.cnpj ?? '',
        name: company?.name ?? '',
      },
      memberInsurance: {
        cardNumber: mi.cardNumber,
        memberName: mi.memberName ?? '',
        validUntil: mi.validUntil,
        category: mi.category,
      },
      items: guideItems,
      totalCents,
      issueDate: new Date().toISOString().slice(0, 10),
      authorizationNumber: auth?.authorizationNumber ?? null,
    }

    const xml = generateGuideXml(guideInput)

    // 10. Persiste guide + items
    try {
      const [guide] = await db
        .insert(billingGuides)
        .values({
          tenantId,
          companyId: mi.companyId,
          memberId: mi.memberId,
          memberInsuranceId: mi.id,
          kind: parsed.kind,
          guideNumber: parsed.guideNumber,
          authorizationId: parsed.authorizationId ?? null,
          totalCents,
          copayCents: procPrice?.patientCopayCents ?? 0,
          status: 'ready',
          xmlSent: xml,
          professionalSnapshot: {
            name: profPerson?.name ?? profUser.username,
            councilBody: activeReg!.councilBody,
            councilState: activeReg!.councilState,
            councilNumber: activeReg!.councilNumber,
            cbosCode: activeReg!.cboCode,
          },
          tussVersion: '2026.01',
        })
        .returning({ id: billingGuides.id })

      for (const it of guideItems) {
        await db.insert(billingGuideItems).values({
          tenantId,
          guideId: guide!.id,
          sequenceNumber: it.sequenceNumber,
          tussCode: it.tussCode,
          description: it.description,
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          totalCents: it.totalCents,
          professionalUserId: firstItem.professionalUserId,
          cbosCode: activeReg!.cboCode,
        })
      }

      setAuditResource(guide!.id, { kind: parsed.kind, totalCents })
      return { id: guide!.id, totalCents, xml, validationIssues: validation.issues }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Número de guia já existe neste tenant',
          request_id: '',
        })
      }
      throw err
    }
  },
)

export const listBillingGuides = wrapServerAction(
  { module: 'fisio', action: 'convenio.guide_list' },
  async (input: { status?: string; limit?: number } | undefined, { session }) => {
    const parsed = z
      .object({
        status: z
          .enum([
            'draft',
            'ready',
            'sent',
            'paid',
            'partially_paid',
            'fully_glossed',
            'cancelled',
            'all',
          ])
          .default('all'),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(input ?? {})
    const tenantId = session.logifit.tenantId
    const where = [eq(billingGuides.tenantId, tenantId)]
    if (parsed.status !== 'all') where.push(eq(billingGuides.status, parsed.status))
    const rows = await db
      .select({
        id: billingGuides.id,
        guideNumber: billingGuides.guideNumber,
        kind: billingGuides.kind,
        status: billingGuides.status,
        totalCents: billingGuides.totalCents,
        paidAmountCents: billingGuides.paidAmountCents,
        memberId: billingGuides.memberId,
        memberName: persons.name,
        sentAt: billingGuides.sentAt,
        paidAt: billingGuides.paidAt,
        createdAt: billingGuides.createdAt,
      })
      .from(billingGuides)
      .leftJoin(members, eq(members.id, billingGuides.memberId))
      .leftJoin(persons, eq(persons.id, members.personId))
      .where(and(...where))
      .orderBy(desc(billingGuides.createdAt))
      .limit(parsed.limit)
    return { guides: rows }
  },
)

// ─── createBatch ─────────────────────────────────────────────────────────

export const createBatch = wrapServerAction(
  { module: 'fisio', action: 'convenio.batch_create', resourceType: 'billing_batches' },
  async (input: z.infer<typeof CreateBatchInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateBatchInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Carrega guides ready + plano comum
    const guides = await db
      .select({
        id: billingGuides.id,
        kind: billingGuides.kind,
        xml: billingGuides.xmlSent,
        status: billingGuides.status,
      })
      .from(billingGuides)
      .where(and(eq(billingGuides.tenantId, tenantId), inArray(billingGuides.id, parsed.guideIds)))

    if (guides.length === 0)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Nenhuma guia válida fornecida',
        request_id: '',
      })

    const wrongStatus = guides.find((g) => g.status !== 'ready')
    if (wrongStatus)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Guia ${wrongStatus.id} está em status "${wrongStatus.status}" (somente "ready" agrupável)`,
        request_id: '',
      })

    const [agreement] = await db
      .select({
        id: insuranceAgreements.id,
        planAnsCode: insurancePlans.ansCode,
        planName: insurancePlans.name,
      })
      .from(insuranceAgreements)
      .innerJoin(insurancePlans, eq(insurancePlans.id, insuranceAgreements.planId))
      .where(
        and(
          eq(insuranceAgreements.id, parsed.agreementId),
          eq(insuranceAgreements.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!agreement)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Acordo não encontrado',
        request_id: '',
      })

    // Pega company do primeiro guide pra CNPJ prestador
    const [firstGuideRow] = await db
      .select({ companyId: billingGuides.companyId })
      .from(billingGuides)
      .where(and(eq(billingGuides.id, guides[0]!.id), eq(billingGuides.tenantId, tenantId)))
      .limit(1)
    const [company] = firstGuideRow
      ? await db
          .select({ name: persons.name, cnpj: persons.document })
          .from(companies)
          .leftJoin(persons, eq(persons.id, companies.personId))
          .where(and(eq(companies.id, firstGuideRow.companyId), eq(companies.tenantId, tenantId)))
          .limit(1)
      : [undefined]

    const xml = generateBatchXml({
      tissVersion: '4.01',
      batchNumber: parsed.batchNumber,
      guides: guides.map((g) => ({ kind: g.kind as 'consulta' | 'sp_sadt', xml: g.xml ?? '' })),
      operator: { ansCode: agreement.planAnsCode ?? '', name: agreement.planName },
      prestador: { cnpj: company?.cnpj ?? '', name: company?.name ?? '' },
      issueDate: new Date().toISOString().slice(0, 10),
    })

    try {
      const [batch] = await db
        .insert(billingBatches)
        .values({
          tenantId,
          agreementId: parsed.agreementId,
          batchNumber: parsed.batchNumber,
          guideIds: guides.map((g) => g.id),
          xml,
          status: 'sent',
          sentAt: new Date(),
          tissVersion: '4.01',
          sentByUserId: session.logifit.userId,
        })
        .returning({ id: billingBatches.id })

      // Atualiza guides → status='sent'
      await db
        .update(billingGuides)
        .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
        .where(
          inArray(
            billingGuides.id,
            guides.map((g) => g.id),
          ),
        )

      setAuditResource(batch!.id, { guideCount: guides.length })
      return { id: batch!.id, xml, guideCount: guides.length }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Número de lote já existe',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── processReturnXml ────────────────────────────────────────────────────

export const processReturnXml = wrapServerAction(
  { module: 'fisio', action: 'convenio.return_process', resourceType: 'billing_batches' },
  async (input: z.infer<typeof ProcessReturnXmlInputSchema>, { session, setAuditResource }) => {
    const parsed = ProcessReturnXmlInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const parsedReturn = parseReturnXml(parsed.xml)
    if (parsedReturn.items.length === 0)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'XML não contém guiaResposta válidas',
        request_id: '',
      })

    let updated = 0
    let glosasCreated = 0

    for (const item of parsedReturn.items) {
      // Encontra guia
      const [guide] = await db
        .select({ id: billingGuides.id, totalCents: billingGuides.totalCents })
        .from(billingGuides)
        .where(
          and(
            eq(billingGuides.tenantId, tenantId),
            eq(billingGuides.guideNumber, item.guideNumber),
          ),
        )
        .limit(1)
      if (!guide) continue

      // Atualiza status + valor pago
      await db
        .update(billingGuides)
        .set({
          status: item.status === 'unknown' ? 'sent' : item.status,
          paidAmountCents: item.paidAmountCents,
          paidAt: item.status === 'paid' || item.status === 'partially_paid' ? new Date() : null,
          operatorGuideNumber: item.operatorGuideNumber ?? null,
          updatedAt: new Date(),
        })
        .where(eq(billingGuides.id, guide.id))
      updated += 1

      // Cria glosas
      for (const g of item.glosas) {
        if (g.amountGlossedCents <= 0) continue
        await db
          .insert(billingGlosas)
          .values({
            tenantId,
            guideId: guide.id,
            reasonCode: g.reasonCode,
            reasonDescription: g.reasonDescription,
            amountGlossedCents: g.amountGlossedCents,
            status: 'glossed',
          })
          .catch(() => {
            // Ignora dupes em re-processamento (Sprint 22b melhora idempotência)
          })
        glosasCreated += 1
      }
    }

    // Tenta atualizar batch
    if (parsedReturn.batchNumber) {
      await db
        .update(billingBatches)
        .set({
          status: 'returned',
          returnedAt: new Date(),
          returnXml: parsed.xml,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(billingBatches.tenantId, tenantId),
            eq(billingBatches.batchNumber, parsedReturn.batchNumber),
          ),
        )
    }

    setAuditResource(parsedReturn.batchNumber ?? 'unknown', { updated, glosasCreated })
    return { updated, glosasCreated, batchNumber: parsedReturn.batchNumber }
  },
)

// ─── fileGlosa (recurso) ────────────────────────────────────────────────

export const fileGlosa = wrapServerAction(
  { module: 'fisio', action: 'convenio.glosa_recurso', resourceType: 'billing_glosas' },
  async (input: z.infer<typeof FileGlosaInputSchema>, { session, setAuditResource }) => {
    const parsed = FileGlosaInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .update(billingGlosas)
      .set({
        status: 'recurring',
        recursoBody: parsed.recursoBody,
        recursoAt: new Date(),
        recursoByUserId: session.logifit.userId,
      })
      .where(and(eq(billingGlosas.id, parsed.glosaId), eq(billingGlosas.tenantId, tenantId)))
      .returning({ id: billingGlosas.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Glosa não encontrada',
        request_id: '',
      })
    setAuditResource(row.id, {})
    return { ok: true }
  },
)

export const listGlosas = wrapServerAction(
  { module: 'fisio', action: 'convenio.glosa_list' },
  async (input: { status?: string } | undefined, { session }) => {
    const parsed = z
      .object({
        status: z.enum(['glossed', 'recurring', 'recovered', 'lost', 'all']).default('all'),
      })
      .parse(input ?? {})
    const tenantId = session.logifit.tenantId
    const where = [eq(billingGlosas.tenantId, tenantId)]
    if (parsed.status !== 'all') where.push(eq(billingGlosas.status, parsed.status))
    const rows = await db
      .select({
        id: billingGlosas.id,
        guideId: billingGlosas.guideId,
        reasonCode: billingGlosas.reasonCode,
        reasonDescription: billingGlosas.reasonDescription,
        amountGlossedCents: billingGlosas.amountGlossedCents,
        status: billingGlosas.status,
        receivedAt: billingGlosas.receivedAt,
        recursoAt: billingGlosas.recursoAt,
      })
      .from(billingGlosas)
      .where(and(...where))
      .orderBy(desc(billingGlosas.receivedAt))
      .limit(200)
    return { glosas: rows }
  },
)
