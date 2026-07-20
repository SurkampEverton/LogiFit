'use server'

import { lookupCnpj } from '@repo/cnpj'
import type { CnpjData } from '@repo/cnpj'
import { db } from '@repo/db/client'
import { parseDocument } from '@repo/db/persons'
import { persons } from '@repo/db/schema'
import type { PersonInsert, PersonRow } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { addressSchema, normalizeAddress } from '@repo/types'
/**
 * Server Actions de persons — Sprint 01a Faixa F: migradas pra `wrapServerAction()`.
 *
 * Cada export passa por:
 *   1. requireFullSession → garante tenant claims
 *   2. requireRecentMfaForAction → MFA gate se high-risk (regra 43)
 *   3. withSessionContext → seta app.tenant_id na conexão (RLS aplica)
 *   4. audit_log fire-and-forget (regra 5 + hash chain regra 39)
 *   5. envelope ADR 0071 ({ ok, data | error })
 */
import { and, eq, ilike, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── searchPersons ────────────────────────────────────────────────────────
const searchPersonsInputSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(['pf', 'pj']).optional(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
})

export const searchPersons = wrapServerAction(
  { module: 'persons', action: 'person.search', resourceType: 'persons' },
  async (rawInput: z.input<typeof searchPersonsInputSchema>): Promise<PersonRow[]> => {
    const input = searchPersonsInputSchema.parse(rawInput)

    const conditions = []
    if (input.kind) conditions.push(eq(persons.kind, input.kind))
    if (!input.includeArchived) conditions.push(isNull(persons.archivedAt))

    if (input.query) {
      const q = input.query
      const queryDigits = q.replace(/\D/g, '')
      const orParts = [ilike(persons.name, `%${q}%`), ilike(persons.displayName, `%${q}%`)]
      if (queryDigits.length >= 3) {
        orParts.push(ilike(persons.document, `%${queryDigits}%`))
      }
      const orClause = or(...orParts)
      if (orClause) conditions.push(orClause)
    }

    const rows = await db
      .select()
      .from(persons)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(persons.name)
      .limit(input.limit)

    return rows
  },
)

// ─── lookupCnpjAction ─────────────────────────────────────────────────────
const lookupCnpjInputSchema = z.object({
  cnpj: z.string().trim().min(11).max(20),
  skipCache: z.boolean().default(false),
})

export const lookupCnpjAction = wrapServerAction(
  { module: 'persons', action: 'cnpj.lookup' },
  async (
    rawInput: z.input<typeof lookupCnpjInputSchema>,
  ): Promise<CnpjData & { fromCache: boolean }> => {
    const input = lookupCnpjInputSchema.parse(rawInput)
    const result = await lookupCnpj(input.cnpj, { skipCache: input.skipCache })
    if (!result.ok) {
      throw new ApiException({
        code:
          result.error.code === 'CNPJ_NOT_FOUND'
            ? 'NOT_FOUND'
            : result.error.code === 'CNPJ_INVALID'
              ? 'VALIDATION_ERROR'
              : result.error.code === 'CNPJ_RATE_LIMITED'
                ? 'RATE_LIMITED'
                : 'SERVICE_UNAVAILABLE',
        message: messageForCnpjError(result.error),
        request_id: '', // wrapAction reescreve
      })
    }
    return { ...result.data, fromCache: result.fromCache }
  },
)

function messageForCnpjError(err: { code: string }): string {
  switch (err.code) {
    case 'CNPJ_NOT_FOUND':
      return 'CNPJ não encontrado na Receita Federal'
    case 'CNPJ_INVALID':
      return 'CNPJ inválido — verifique o dígito verificador'
    case 'CNPJ_PROVIDER_DOWN':
      return 'Provider de consulta CNPJ está indisponível — tente novamente'
    case 'CNPJ_RATE_LIMITED':
      return 'Limite de consultas atingido — aguarde alguns instantes'
    default:
      return 'Erro ao consultar CNPJ'
  }
}

// ─── createPerson ─────────────────────────────────────────────────────────
const createPersonInputSchema = z.object({
  document: z.string().trim().optional(),
  name: z.string().trim().min(2).max(200).optional(),
  displayName: z.string().trim().max(200).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sex: z.string().trim().max(50).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().trim().max(50).optional(),
  address: addressSchema.optional(),
  notes: z.string().max(2000).optional(),
  autoFillCnpj: z.boolean().default(true),
})

export const createPerson = wrapServerAction(
  { module: 'persons', action: 'person.create', resourceType: 'persons' },
  async (rawInput: z.input<typeof createPersonInputSchema>, ctx): Promise<PersonRow> => {
    const input = createPersonInputSchema.parse(rawInput)

    let kind: 'pf' | 'pj' | null = null
    let normalizedDocument: string | null = null
    if (input.document) {
      const doc = parseDocument(input.document)
      if (!doc.ok) {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: `Documento inválido (${doc.reason})`,
          request_id: '',
        })
      }
      kind = doc.kind
      normalizedDocument = doc.normalized
    } else if (input.birthDate || input.sex) {
      kind = 'pf'
    }

    if (!kind) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Forneça documento (CPF/CNPJ) ou dados PF',
        request_id: '',
      })
    }

    let autoFilled: Partial<PersonInsert> = {}
    if (kind === 'pj' && normalizedDocument && input.autoFillCnpj) {
      const lookup = await lookupCnpj(normalizedDocument)
      if (lookup.ok) {
        autoFilled = {
          name: input.name ?? lookup.data.razaoSocial,
          displayName: input.displayName ?? lookup.data.nomeFantasia ?? null,
          email: input.email || lookup.data.email || null,
          phone: input.phone ?? lookup.data.telefone ?? null,
          address: input.address ?? lookup.data.address,
        }
      }
    }

    const finalName = input.name ?? autoFilled.name
    if (!finalName) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Nome é obrigatório',
        request_id: '',
      })
    }

    try {
      const [row] = await db
        .insert(persons)
        .values({
          // why: `withSessionContext` seta `app.tenant_id` numa conexão reservada,
          // mas `db.insert(...)` pega outra conexão do pool. Logo `current_setting()`
          // sem missing_ok lançava `unrecognized configuration parameter`. Passa o
          // tenantId direto do session enquanto refactor pro Drizzle-em-tx fica pendente.
          tenantId: ctx.session.logifit.tenantId,
          kind,
          name: finalName,
          displayName: input.displayName ?? autoFilled.displayName ?? null,
          document: normalizedDocument,
          birthDate: input.birthDate ?? null,
          sex: input.sex ?? null,
          email: input.email || autoFilled.email || null,
          phone: input.phone ?? autoFilled.phone ?? null,
          address: input.address ?? autoFilled.address ?? null,
          notes: input.notes ?? null,
        })
        .returning()
      if (!row) {
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'insert retornou vazio',
          request_id: '',
        })
      }
      ctx.setAuditResource(row.id, { kind, hasDocument: !!normalizedDocument })
      return row
    } catch (err) {
      if (err instanceof ApiException) throw err
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('persons_tenant_document_uq')) {
        throw new ApiException({
          code: 'CONFLICT',
          message: 'Documento já cadastrado neste tenant',
          request_id: '',
        })
      }
      throw err // translator do wrapAction pega
    }
  },
)

// ─── archivePerson ────────────────────────────────────────────────────────
const archivePersonInputSchema = z.object({
  id: z.string().uuid(),
})

export const archivePerson = wrapServerAction(
  { module: 'persons', action: 'person.archive', resourceType: 'persons' },
  async (rawInput: z.input<typeof archivePersonInputSchema>, ctx): Promise<PersonRow> => {
    const input = archivePersonInputSchema.parse(rawInput)

    const [row] = await db
      .update(persons)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      // Escopo de tenant: sem isso, qualquer pessoa de qualquer tenant
      // seria arquivavel so por conhecer o id.
      .where(and(eq(persons.id, input.id), eq(persons.tenantId, ctx.session.logifit.tenantId)))
      .returning()
    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Pessoa não encontrada',
        request_id: '',
      })
    }
    ctx.setAuditResource(row.id)
    return row
  },
)

// ─── updatePerson ─────────────────────────────────────────────────────────

const updatePersonInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(200).optional(),
  displayName: z.string().trim().max(200).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(50).nullable().optional(),
  address: addressSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

/**
 * Edita identidade, contato e endereço de uma pessoa.
 *
 * O cadastro central (`persons`, ADR 0047) tinha criar e arquivar, mas não
 * editar: corrigir um e-mail ou endereço exigia mexer no banco. Como toda
 * entidade especializada (empresa, member, fornecedor) aponta pra cá, esses
 * campos são editados **só aqui** — telas especializadas compõem esta, em vez
 * de replicar os campos e divergir na validação.
 *
 * `document` não é editável: mudar CNPJ/CPF de uma pessoa já vinculada
 * reescreveria a identidade de tudo que aponta pra ela. Corrigir documento
 * errado é arquivar e recriar.
 */
export const updatePerson = wrapServerAction(
  { module: 'persons', action: 'person.update', resourceType: 'persons' },
  async (rawInput: z.input<typeof updatePersonInputSchema>, ctx): Promise<PersonRow> => {
    const input = updatePersonInputSchema.parse(rawInput)

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (input.name !== undefined) patch.name = input.name
    if (input.displayName !== undefined) patch.displayName = input.displayName || null
    if (input.email !== undefined) patch.email = input.email || null
    if (input.phone !== undefined) patch.phone = input.phone || null
    if (input.notes !== undefined) patch.notes = input.notes || null
    if (input.address !== undefined) patch.address = normalizeAddress(input.address)

    const [row] = await db
      .update(persons)
      .set(patch)
      .where(and(eq(persons.id, input.id), eq(persons.tenantId, ctx.session.logifit.tenantId)))
      .returning()
    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Pessoa não encontrada',
        request_id: '',
      })
    }
    ctx.setAuditResource(row.id, { fields: Object.keys(patch).filter((k) => k !== 'updatedAt') })
    return row
  },
)
