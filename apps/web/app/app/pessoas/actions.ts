'use server'

/**
 * Server Actions para `persons` (ADR 0047 — cadastro central).
 *
 * Padrão LogiFit pra envelope (ADR 0071 — implementação completa em
 * `@repo/errors/wrapAction` vem na Faixa F). Sprint 01a Faixa D usa
 * envelope manual `{ ok: true/false }` — refatorar pra wrapAction quando
 * Sprint F entregar.
 *
 * Todas as ações:
 *   1. requireFullSession() → garante user autenticado com tenant claim
 *   2. validar input com Zod (regra 7)
 *   3. setar `app.tenant_id` via `withSessionContext()` → RLS aplica
 *   4. retornar `{ ok, data | error }` tipado
 */
import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { lookupCnpj } from '@repo/cnpj'
import type { CnpjData } from '@repo/cnpj'
import { db } from '@repo/db/client'
import { parseDocument } from '@repo/db/persons'
import { persons } from '@repo/db/schema'
import type { PersonInsert, PersonRow } from '@repo/db/schema'
import { requireFullSession, withSessionContext } from '../../lib/session'

// ─── Envelope tipado (placeholder até wrapAction) ─────────────────────────
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

// ─── searchPersons ────────────────────────────────────────────────────────
const searchPersonsInputSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(['pf', 'pj']).optional(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
})

// wrap-exempt: Sprint 01a Faixa D — envelope manual; Faixa F migra pra wrapAction()
export async function searchPersons(
  rawInput: z.input<typeof searchPersonsInputSchema>,
): Promise<ActionResult<PersonRow[]>> {
  const session = await requireFullSession('/app/pessoas')
  const parsed = searchPersonsInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'input inválido', details: parsed.error.flatten() },
    }
  }
  const input = parsed.data

  return withSessionContext(session.logifit, async () => {
    const conditions = []
    if (input.kind) conditions.push(eq(persons.kind, input.kind))
    if (!input.includeArchived) conditions.push(isNull(persons.archivedAt))

    if (input.query) {
      // Busca por nome / display_name / document (sem formatação)
      const q = input.query
      const queryDigits = q.replace(/\D/g, '')
      const orParts = [
        ilike(persons.name, `%${q}%`),
        ilike(persons.displayName, `%${q}%`),
      ]
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

    return { ok: true, data: rows }
  })
}

// ─── lookupCnpjAction ─────────────────────────────────────────────────────
const lookupCnpjInputSchema = z.object({
  cnpj: z.string().trim().min(11).max(20), // aceita formatado e não-formatado
  skipCache: z.boolean().default(false),
})

// wrap-exempt: Sprint 01a Faixa D — envelope manual; Faixa F migra pra wrapAction()
export async function lookupCnpjAction(
  rawInput: z.input<typeof lookupCnpjInputSchema>,
): Promise<ActionResult<CnpjData & { fromCache: boolean }>> {
  await requireFullSession('/app/pessoas/new')
  const parsed = lookupCnpjInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'CNPJ inválido', details: parsed.error.flatten() },
    }
  }

  const result = await lookupCnpj(parsed.data.cnpj, { skipCache: parsed.data.skipCache })
  if (!result.ok) {
    // Mapeia CnpjLookupError → envelope ActionResult
    return { ok: false, error: { code: result.error.code, message: messageForCnpjError(result.error) } }
  }

  return { ok: true, data: { ...result.data, fromCache: result.fromCache } }
}

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
  document: z.string().trim().optional(), // CPF/CNPJ — opcional pra cadastro parcial
  name: z.string().trim().min(2).max(200).optional(), // pode vir de autoFill
  displayName: z.string().trim().max(200).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sex: z.string().trim().max(50).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().trim().max(50).optional(),
  address: z
    .object({
      cep: z.string().optional(),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      cidade: z.string().optional(),
      uf: z.string().length(2).optional(),
    })
    .optional(),
  notes: z.string().max(2000).optional(),
  /** Se documento for CNPJ e autoFillCnpj=true, busca dados na Receita antes de salvar. */
  autoFillCnpj: z.boolean().default(true),
})

// wrap-exempt: Sprint 01a Faixa D — envelope manual; Faixa F migra pra wrapAction()
export async function createPerson(
  rawInput: z.input<typeof createPersonInputSchema>,
): Promise<ActionResult<PersonRow>> {
  const session = await requireFullSession('/app/pessoas/new')
  const parsed = createPersonInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'dados inválidos', details: parsed.error.flatten() },
    }
  }
  const input = parsed.data

  // 1. Valida documento (CPF/CNPJ) se fornecido
  let kind: 'pf' | 'pj' | null = null
  let normalizedDocument: string | null = null
  if (input.document) {
    const doc = parseDocument(input.document)
    if (!doc.ok) {
      return {
        ok: false,
        error: { code: 'INVALID_DOCUMENT', message: `documento inválido (${doc.reason})` },
      }
    }
    kind = doc.kind
    normalizedDocument = doc.normalized
  } else if (input.birthDate || input.sex) {
    kind = 'pf' // tem campo PF-only → assume PF
  }

  if (!kind) {
    return {
      ok: false,
      error: { code: 'KIND_REQUIRED', message: 'forneça documento (CPF/CNPJ) ou dados PF' },
    }
  }

  // 2. Auto-fill CNPJ se aplicável
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
      // Alerta de situação ≠ ativa — Sprint 01a Faixa D: log warning;
      // UI mostra banner antes do confirm (Faixa D fechamento)
      if (lookup.data.situacao !== 'ativa') {
        console.warn(
          `[persons] criando company ${normalizedDocument} com situação ${lookup.data.situacao}`,
        )
      }
    }
    // lookup falhou? continua com dados manuais (não bloqueia)
  }

  // 3. Required check após autoFill
  const finalName = input.name ?? autoFilled.name
  if (!finalName) {
    return {
      ok: false,
      error: { code: 'NAME_REQUIRED', message: 'nome é obrigatório' },
    }
  }

  // 4. Insert com session context (RLS preenche tenant_id via app.tenant_id)
  return withSessionContext(session.logifit, async () => {
    try {
      const inserted = await db
        .insert(persons)
        .values({
          tenantId: sql`current_setting('app.tenant_id')::uuid`,
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
      const row = inserted[0]
      if (!row) {
        return { ok: false, error: { code: 'INTERNAL', message: 'insert retornou vazio' } }
      }
      return { ok: true, data: row }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Detect unique constraint do documento por tenant
      if (msg.includes('persons_tenant_document_uq')) {
        return {
          ok: false,
          error: { code: 'DOCUMENT_TAKEN', message: 'documento já cadastrado neste tenant' },
        }
      }
      return { ok: false, error: { code: 'INTERNAL', message: msg.slice(0, 200) } }
    }
  })
}

// ─── archivePerson ────────────────────────────────────────────────────────
const archivePersonInputSchema = z.object({
  id: z.string().uuid(),
})

// wrap-exempt: Sprint 01a Faixa D — envelope manual; Faixa F migra pra wrapAction()
export async function archivePerson(
  rawInput: z.input<typeof archivePersonInputSchema>,
): Promise<ActionResult<PersonRow>> {
  const session = await requireFullSession('/app/pessoas')
  const parsed = archivePersonInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'id inválido' } }
  }

  return withSessionContext(session.logifit, async () => {
    const updated = await db
      .update(persons)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(persons.id, parsed.data.id))
      .returning()
    const row = updated[0]
    if (!row) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'pessoa não encontrada' } }
    }
    return { ok: true, data: row }
  })
}
