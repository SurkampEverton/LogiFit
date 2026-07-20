'use server'

import { db } from '@repo/db/client'
import { type CompanyRow, companies, persons } from '@repo/db/schema'
/**
 * Server Actions de companies (matriz/filial — Sprint 01a Faixa E).
 *
 * `createCompany` linka uma `persons` kind=pj existente (no tenant atual)
 * a uma nova company filial. Matriz é criada apenas no onboarding inicial
 * (`/signup` wizard) — regra 21 garante 1 matriz por tenant via unique parcial.
 *
 * `listCompanies` + `listAvailablePjPersons` alimentam a UI.
 */
import { ApiException } from '@repo/errors'
import { and, eq, isNull, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../../../lib/permissions'
import { requireFullSession, withSessionContext } from '../../../lib/session'
import { wrapServerAction } from '../../../lib/wrap-action'

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

// ─── listCompanies ────────────────────────────────────────────────────────
export async function listCompanies(): Promise<
  ActionResult<
    Array<
      CompanyRow & {
        personName: string
        displayName: string | null
        document: string | null
        email: string | null
        phone: string | null
        address: unknown
      }
    >
  >
> {
  const session = await requireFullSession('/app/settings/empresas')

  return withSessionContext(session.logifit, async () => {
    const rows = await db
      .select({
        id: companies.id,
        tenantId: companies.tenantId,
        personId: companies.personId,
        type: companies.type,
        parentCompanyId: companies.parentCompanyId,
        ie: companies.ie,
        im: companies.im,
        regimeTributario: companies.regimeTributario,
        cnesCode: companies.cnesCode,
        habilitaNfse: companies.habilitaNfse,
        habilitaNfe: companies.habilitaNfe,
        habilitaNfce: companies.habilitaNfce,
        focusEmpresaId: companies.focusEmpresaId,
        municipalCredentialsConfiguredAt: companies.municipalCredentialsConfiguredAt,
        createdAt: companies.createdAt,
        updatedAt: companies.updatedAt,
        personName: persons.name,
        displayName: persons.displayName,
        document: persons.document,
        email: persons.email,
        phone: persons.phone,
        address: persons.address,
      })
      .from(companies)
      .innerJoin(persons, eq(persons.id, companies.personId))
      // Filtro explicito: a RLS via withSessionContext nao alcanca o pool do
      // Drizzle (ver session.ts), entao depender so dela vaza entre tenants.
      .where(eq(companies.tenantId, session.logifit.tenantId))
      .orderBy(companies.type, persons.name)

    return { ok: true, data: rows }
  })
}

// ─── listAvailablePjPersons ───────────────────────────────────────────────
// Persons PJ não-arquivadas que ainda não viraram company no tenant (pra
// dropdown "linka existente" no form de nova filial).
export async function listAvailablePjPersons(): Promise<
  ActionResult<Array<{ id: string; name: string; document: string | null }>>
> {
  const session = await requireFullSession('/app/settings/empresas/new')

  return withSessionContext(session.logifit, async () => {
    // Subquery: person_ids já vinculados a alguma company
    const linkedIds = await db
      .select({ personId: companies.personId })
      .from(companies)
      .where(eq(companies.tenantId, session.logifit.tenantId))

    const linkedSet = new Set(linkedIds.map((r) => r.personId))
    const linkedArr = Array.from(linkedSet)

    const conditions = [
      eq(persons.tenantId, session.logifit.tenantId),
      eq(persons.kind, 'pj'),
      isNull(persons.archivedAt),
    ]
    if (linkedArr.length > 0) {
      conditions.push(notInArray(persons.id, linkedArr))
    }

    const rows = await db
      .select({ id: persons.id, name: persons.name, document: persons.document })
      .from(persons)
      .where(and(...conditions))
      .orderBy(persons.name)

    return { ok: true, data: rows }
  })
}

// ─── createFilial ─────────────────────────────────────────────────────────
const createFilialInputSchema = z.object({
  personId: z.string().uuid(),
  parentCompanyId: z.string().uuid().optional(), // se omitido, busca matriz
  ie: z.string().trim().max(50).optional(),
  im: z.string().trim().max(50).optional(),
  regimeTributario: z.enum(['simples', 'presumido', 'real', 'mei']).optional(),
  cnesCode: z.string().trim().max(20).optional(),
})

// wrap-exempt: Sprint 01a Faixa E — envelope manual; Faixa F migra pra wrapAction()
export async function createFilial(
  rawInput: z.input<typeof createFilialInputSchema>,
): Promise<ActionResult<CompanyRow>> {
  const session = await requireFullSession('/app/settings/empresas/new')
  const parsed = createFilialInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'dados inválidos',
        details: parsed.error.flatten(),
      },
    }
  }
  const input = parsed.data

  return withSessionContext(session.logifit, async () => {
    // Acha matriz se parentCompanyId não foi passado
    let parentId = input.parentCompanyId
    if (!parentId) {
      const matriz = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.type, 'matriz'))
        .limit(1)
      if (!matriz[0]) {
        return {
          ok: false,
          error: { code: 'NO_MATRIZ', message: 'matriz não encontrada — crie em /signup' },
        }
      }
      parentId = matriz[0].id
    }

    try {
      const [row] = await db
        .insert(companies)
        .values({
          tenantId: session.logifit.tenantId,
          personId: input.personId,
          type: 'filial',
          parentCompanyId: parentId,
          ie: input.ie ?? null,
          im: input.im ?? null,
          regimeTributario: input.regimeTributario ?? null,
          cnesCode: input.cnesCode ?? null,
        })
        .returning()
      if (!row) return { ok: false, error: { code: 'INTERNAL', message: 'insert retornou vazio' } }
      return { ok: true, data: row }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('companies_person_per_tenant_uq')) {
        return {
          ok: false,
          error: {
            code: 'PERSON_ALREADY_COMPANY',
            message: 'esta PJ já é uma company neste tenant',
          },
        }
      }
      if (msg.includes('kind=pj')) {
        return {
          ok: false,
          error: { code: 'PERSON_NOT_PJ', message: 'person_id deve apontar pra PJ' },
        }
      }
      return { ok: false, error: { code: 'INTERNAL', message: msg.slice(0, 200) } }
    }
  })
}

// ─── updateCompanyRegistration ────────────────────────────────────────────

/** Endereço no shape que `persons.address` documenta e que a Focus espera. */
const AddressSchema = z.object({
  cep: z.string().trim().max(9).optional(),
  logradouro: z.string().trim().max(200).optional(),
  numero: z.string().trim().max(20).optional(),
  complemento: z.string().trim().max(100).optional(),
  bairro: z.string().trim().max(100).optional(),
  cidade: z.string().trim().max(100).optional(),
  uf: z.string().trim().length(2).optional(),
})

const UpdateCompanyRegistrationSchema = z.object({
  companyId: z.string().uuid(),
  // Identificação (mora em persons — regra 22: CNPJ no cadastro central)
  name: z.string().trim().min(2).max(200).optional(),
  displayName: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: AddressSchema.nullable().optional(),
  // Fiscal (mora em companies)
  ie: z.string().trim().max(50).nullable().optional(),
  im: z.string().trim().max(50).nullable().optional(),
  regimeTributario: z.enum(['simples', 'presumido', 'real', 'mei']).nullable().optional(),
  habilitaNfse: z.boolean().optional(),
  habilitaNfe: z.boolean().optional(),
  habilitaNfce: z.boolean().optional(),
})

/**
 * Cadastro completo da empresa — identificação, contato, endereço, dados
 * fiscais e habilitações.
 *
 * Escreve em duas tabelas porque a identidade vive em `persons` (regra 22) e o
 * que é específico de pessoa jurídica operante vive em `companies`. Transação
 * para não deixar metade gravada.
 *
 * Cobre exatamente o que o cadastro de empresa na Focus exige: sem endereço
 * completo e e-mail não há como criar a empresa lá — e até aqui esses campos
 * não tinham tela, só existiam no schema.
 */
export const updateCompanyRegistration = wrapServerAction(
  { module: 'settings', action: 'company.update_registration', resourceType: 'company' },
  async (input: z.infer<typeof UpdateCompanyRegistrationSchema>, { session, setAuditResource }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const parsed = UpdateCompanyRegistrationSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [company] = await db
      .select({ id: companies.id, personId: companies.personId })
      .from(companies)
      .where(and(eq(companies.id, parsed.companyId), eq(companies.tenantId, tenantId)))
      .limit(1)
    if (!company)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Empresa não encontrada neste tenant',
        request_id: '',
      })

    await db.transaction(async (tx) => {
      const personPatch: Record<string, unknown> = {}
      if (parsed.name !== undefined) personPatch.name = parsed.name
      if (parsed.displayName !== undefined) personPatch.displayName = parsed.displayName || null
      if (parsed.email !== undefined) personPatch.email = parsed.email || null
      if (parsed.phone !== undefined) personPatch.phone = parsed.phone || null
      if (parsed.address !== undefined) {
        // Endereço vazio vira NULL em vez de objeto de campos em branco —
        // assim "não informado" é distinguível de "informado vazio".
        const filled = parsed.address
          ? Object.fromEntries(Object.entries(parsed.address).filter(([, v]) => v))
          : {}
        personPatch.address = Object.keys(filled).length > 0 ? filled : null
      }
      if (Object.keys(personPatch).length > 0) {
        personPatch.updatedAt = new Date()
        await tx.update(persons).set(personPatch).where(eq(persons.id, company.personId))
      }

      const companyPatch: Record<string, unknown> = {}
      if (parsed.ie !== undefined) companyPatch.ie = parsed.ie || null
      if (parsed.im !== undefined) companyPatch.im = parsed.im || null
      if (parsed.regimeTributario !== undefined)
        companyPatch.regimeTributario = parsed.regimeTributario
      if (parsed.habilitaNfse !== undefined) companyPatch.habilitaNfse = parsed.habilitaNfse
      if (parsed.habilitaNfe !== undefined) companyPatch.habilitaNfe = parsed.habilitaNfe
      if (parsed.habilitaNfce !== undefined) companyPatch.habilitaNfce = parsed.habilitaNfce
      if (Object.keys(companyPatch).length > 0) {
        companyPatch.updatedAt = new Date()
        await tx.update(companies).set(companyPatch).where(eq(companies.id, company.id))
      }
    })

    setAuditResource(company.id, { fields: Object.keys(parsed).filter((k) => k !== 'companyId') })
    return { id: company.id }
  },
)
