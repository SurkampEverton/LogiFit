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
import { and, eq, isNull, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import { requireFullSession, withSessionContext } from '../../../lib/session'

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

// ─── listCompanies ────────────────────────────────────────────────────────
export async function listCompanies(): Promise<
  ActionResult<Array<CompanyRow & { personName: string; document: string | null }>>
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
        createdAt: companies.createdAt,
        updatedAt: companies.updatedAt,
        personName: persons.name,
        document: persons.document,
      })
      .from(companies)
      .innerJoin(persons, eq(persons.id, companies.personId))
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
    const linkedIds = await db.select({ personId: companies.personId }).from(companies)

    const linkedSet = new Set(linkedIds.map((r) => r.personId))
    const linkedArr = Array.from(linkedSet)

    const conditions = [eq(persons.kind, 'pj'), isNull(persons.archivedAt)]
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
