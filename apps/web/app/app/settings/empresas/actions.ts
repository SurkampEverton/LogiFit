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
import { syncCompanyUnit } from '../../../lib/company-unit'
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
        .where(and(eq(companies.type, 'matriz'), eq(companies.tenantId, session.logifit.tenantId)))
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
      // Unidade = empresa (ADR 0106): nasce junto, espelhando nome e endereco.
      await syncCompanyUnit(session.logifit.tenantId, row.id)
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

// ─── updateCompanyFiscal ──────────────────────────────────────────────────

const UpdateCompanyFiscalSchema = z.object({
  companyId: z.string().uuid(),
  ie: z.string().trim().max(50).nullable().optional(),
  im: z.string().trim().max(50).nullable().optional(),
  regimeTributario: z.enum(['simples', 'presumido', 'real', 'mei']).nullable().optional(),
  habilitaNfse: z.boolean().optional(),
  habilitaNfe: z.boolean().optional(),
  habilitaNfce: z.boolean().optional(),
})

/**
 * Dados fiscais da empresa — inscrições, regime e habilitações.
 *
 * Escopo deliberadamente restrito a `companies`. Nome, e-mail, telefone e
 * endereço são de `persons` e editados por `updatePerson` (ADR 0047 / regra
 * 22): a tela de empresas compõe `<PersonForm>` em vez de escrever nesses
 * campos por um segundo caminho.
 */
export const updateCompanyFiscal = wrapServerAction(
  { module: 'settings', action: 'company.update_fiscal', resourceType: 'company' },
  async (input: z.infer<typeof UpdateCompanyFiscalSchema>, { session, setAuditResource }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const parsed = UpdateCompanyFiscalSchema.parse(input)

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (parsed.ie !== undefined) patch.ie = parsed.ie || null
    if (parsed.im !== undefined) patch.im = parsed.im || null
    if (parsed.regimeTributario !== undefined) patch.regimeTributario = parsed.regimeTributario
    if (parsed.habilitaNfse !== undefined) patch.habilitaNfse = parsed.habilitaNfse
    if (parsed.habilitaNfe !== undefined) patch.habilitaNfe = parsed.habilitaNfe
    if (parsed.habilitaNfce !== undefined) patch.habilitaNfce = parsed.habilitaNfce

    const [updated] = await db
      .update(companies)
      .set(patch)
      .where(
        and(eq(companies.id, parsed.companyId), eq(companies.tenantId, session.logifit.tenantId)),
      )
      .returning({ id: companies.id })
    if (!updated)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Empresa não encontrada neste tenant',
        request_id: '',
      })

    await syncCompanyUnit(session.logifit.tenantId, updated.id)
    setAuditResource(updated.id, { fields: Object.keys(patch).filter((k) => k !== 'updatedAt') })
    return { id: updated.id }
  },
)
