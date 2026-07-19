'use server'

/**
 * Server Actions Fiscal — Sprint 36 Faixa B.2 (ADR 0059 Accepted).
 *
 * **Backbone Sprint 36a (este arquivo):**
 *   - `listEmissions({filters})` — inbox /app/fiscal
 *   - `getEmission(id)` — detalhe
 *   - `emitNfseFromInvoice(invoiceId)` — emite NFS-e a partir de invoice paga
 *   - `cancelEmission(emissionId, justification)` — MFA recent gate (regra 43)
 *   - `issueCce(emissionId, correction)` — MFA recent gate (regra 43)
 *   - `inutilizeRange(input)` — MFA recent gate (regra 43)
 *   - `queryEmissionStatus(emissionId)` — re-consulta provider
 *   - `retryEmission(emissionId)` — reprocessa rejected com retry_count<3
 *
 * **Pendente Sprint 36b/c:** emitNfeFromSale + emitNfceFromSale + emitNfeReturn
 *   + emitNfeTransfer + emitNfeConsertoOut + emitNfeConsertoReturn +
 *   emitNfeSelfEntry; webhook callback `/api/fiscal/focus-nfe/callback`;
 *   FocusNfeProvider real (safeFetch); resolveFiscalProvider factory;
 *   payload builders por tipo; CBOS/CNAE resolver; aggregate-fiscal-usage-snapshot.
 *
 * **Provider resolution MVP:** sempre retorna `MockFiscalProvider` neste
 * backbone — Sprint 36b implementa factory `resolveFiscalProvider(tenantId)`
 * que faz decrypt de `fiscal_provider_credentials.api_token_encrypted` (AES-256-GCM)
 * e instancia `FocusNfeProvider`. Mock é check-bloqueado em produção.
 */

import type { FiscalEmissionKind, FiscalProvider } from '@repo/ai'
import { db } from '@repo/db/client'
import {
  companies,
  fiscalEmissions,
  fiscalEvents,
  fiscalNumberingSequences,
  fiscalServiceCatalog,
  invoices,
  persons,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { isFeatureEnabled } from '../../lib/feature-flags'
import { resolveFiscalProvider } from '../../lib/fiscal-provider'
import { requirePermission } from '../../lib/permissions'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod schemas ─────────────────────────────────────────────────────────

const FiscalKindEnum = z.enum([
  'nfse',
  'nfe',
  'nfce',
  'nfe_return',
  'nfe_transfer',
  'nfe_conserto_out',
  'nfe_conserto_return',
  'nfe_self_entry',
])

const ListEmissionsInputSchema = z.object({
  companyId: z.string().uuid().optional(),
  kind: FiscalKindEnum.optional(),
  status: z
    .enum(['draft', 'queued', 'processing', 'completed', 'rejected', 'cancelled'])
    .optional(),
  limit: z.number().int().min(1).max(500).default(100),
})

const EmissionIdSchema = z.object({ emissionId: z.string().uuid() })

const EmitNfseFromInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  /** Override do serviço do catálogo (Sprint 36b consome `fiscal_service_catalog`) */
  serviceCatalogId: z.string().uuid().optional(),
})

const EmitNfseManualSchema = z.object({
  companyId: z.string().uuid(),
  serviceCatalogId: z.string().uuid(),
  recipient: z.object({
    /** CPF (11) ou CNPJ (14) — dígitos ou formatado */
    document: z.string().min(11).max(18),
    name: z.string().min(2).max(200),
    email: z.string().email().optional(),
  }),
  valorTotalCents: z.number().int().positive(),
  notes: z.string().max(500).optional(),
})

const CancelEmissionSchema = z.object({
  emissionId: z.string().uuid(),
  justification: z.string().min(15).max(255),
})

const IssueCceSchema = z.object({
  emissionId: z.string().uuid(),
  correction: z.string().min(15).max(1000),
})

const InutilizeRangeSchema = z.object({
  companyId: z.string().uuid(),
  emissionKind: FiscalKindEnum,
  serie: z.number().int().min(1).max(999),
  numeroFrom: z.number().int().positive(),
  numeroTo: z.number().int().positive(),
  justification: z.string().min(15).max(255),
  year: z.number().int().min(2020).max(2099),
})

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Sprint 36b: factory real — decifra credentials e instancia FocusNfeProvider;
 * sem credenciais, mock em dev/test e FORBIDDEN em produção.
 */
async function getProviderForTenant(tenantId: string): Promise<FiscalProvider> {
  return resolveFiscalProvider(tenantId)
}

/**
 * Gate `fiscal_focus_v1` (regra 12) — só ações de emissão/evento; leitura
 * (listEmissions/getEmission) fica livre pra inbox continuar visível.
 */
async function requireFocusFlag(): Promise<void> {
  if (!(await isFeatureEnabled('fiscal_focus_v1'))) {
    throw new ApiException({
      code: 'FORBIDDEN',
      message: 'Emissão fiscal (fiscal_focus_v1) ainda não habilitada neste ambiente.',
      request_id: '',
    })
  }
}

/**
 * Resolve dados fiscais da company: CNPJ (via persons — regra 22 CNPJ mora no
 * cadastro central) + inscrição municipal. Lança se company sem CNPJ válido.
 */
async function resolveCompanyFiscal(
  tenantId: string,
  companyId: string,
): Promise<{ cnpj: string; im: string | null }> {
  const [row] = await db
    .select({ document: persons.document, im: companies.im })
    .from(companies)
    .innerJoin(persons, eq(persons.id, companies.personId))
    .where(and(eq(companies.id, companyId), eq(companies.tenantId, tenantId)))
    .limit(1)
  const cnpj = row?.document?.replace(/\D/g, '') ?? ''
  if (cnpj.length !== 14)
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Company sem CNPJ válido no cadastro — complete os dados fiscais da empresa',
      request_id: '',
    })
  return { cnpj, im: row?.im ?? null }
}

/**
 * Resolve o serviço tributável do catálogo: id explícito do operador, ou o
 * primeiro ativo da company. Lança se catálogo vazio (wizard Step 2 pendente).
 */
async function resolveServiceCatalog(
  tenantId: string,
  companyId: string,
  serviceCatalogId?: string,
): Promise<{
  id: string
  municipalityCode: string
  lc116Code: string | null
  cnae: string | null
  description: string
  issRateBp: number
}> {
  const conds = [
    eq(fiscalServiceCatalog.tenantId, tenantId),
    eq(fiscalServiceCatalog.companyId, companyId),
    eq(fiscalServiceCatalog.active, true),
  ]
  if (serviceCatalogId) conds.push(eq(fiscalServiceCatalog.id, serviceCatalogId))
  const [svc] = await db
    .select({
      id: fiscalServiceCatalog.id,
      municipalityCode: fiscalServiceCatalog.municipalityCode,
      lc116Code: fiscalServiceCatalog.lc116Code,
      cnae: fiscalServiceCatalog.cnae,
      description: fiscalServiceCatalog.description,
      issRateBp: fiscalServiceCatalog.issRateBp,
    })
    .from(fiscalServiceCatalog)
    .where(and(...conds))
    .limit(1)
  if (!svc)
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message:
        'Nenhum serviço tributável cadastrado pra esta empresa — configure o catálogo em Configurações → Fiscal',
      request_id: '',
    })
  return svc
}

/**
 * Atomicamente reserva o próximo número da sequência (FOR UPDATE).
 * Retorna `{serie, numero}` ou cria sequence com `nextNumero=1` se não existir.
 */
async function reserveNextNumero(
  tenantId: string,
  companyId: string,
  kind: FiscalEmissionKind,
  serie: number,
  environment: 'homologacao' | 'producao' = 'homologacao',
): Promise<number> {
  return await db.transaction(async (tx) => {
    // 1. Lock + read existing sequence
    const rows = await tx.execute(sql`
      SELECT id, next_numero
      FROM fiscal_numbering_sequences
      WHERE tenant_id = ${tenantId}
        AND company_id = ${companyId}
        AND kind = ${kind}::fiscal_emission_kind
        AND serie = ${serie}
        AND environment = ${environment}::fiscal_provider_env
      FOR UPDATE
    `)
    const existing = (rows.rows as Array<{ id: string; next_numero: string }>)[0]
    if (existing) {
      const current = Number(existing.next_numero)
      await tx.execute(sql`
        UPDATE fiscal_numbering_sequences
        SET next_numero = next_numero + 1,
            last_used_numero = ${current},
            updated_at = now()
        WHERE id = ${existing.id}
      `)
      return current
    }
    // 2. Sequence não existe — cria com nextNumero=2, retorna 1
    await tx.insert(fiscalNumberingSequences).values({
      tenantId,
      companyId,
      kind,
      serie,
      nextNumero: 2,
      lastUsedNumero: 1,
      environment,
    })
    return 1
  })
}

// ─── listEmissions ──────────────────────────────────────────────────────

export const listEmissions = wrapServerAction(
  { module: 'fiscal', action: 'emission.list', resourceType: 'fiscal_emission' },
  async (input: z.infer<typeof ListEmissionsInputSchema>, { session }) => {
    const parsed = ListEmissionsInputSchema.parse(input)
    const conds = [eq(fiscalEmissions.tenantId, session.logifit.tenantId)]
    if (parsed.companyId) conds.push(eq(fiscalEmissions.companyId, parsed.companyId))
    if (parsed.kind) conds.push(eq(fiscalEmissions.kind, parsed.kind))
    if (parsed.status) conds.push(eq(fiscalEmissions.status, parsed.status))
    const rows = await db
      .select({
        id: fiscalEmissions.id,
        kind: fiscalEmissions.kind,
        status: fiscalEmissions.status,
        provider: fiscalEmissions.provider,
        serie: fiscalEmissions.serie,
        numero: fiscalEmissions.numero,
        chave: fiscalEmissions.chave,
        valorTotalCents: fiscalEmissions.valorTotalCents,
        recipientName: fiscalEmissions.recipientName,
        recipientDocument: fiscalEmissions.recipientDocument,
        rejectionReason: fiscalEmissions.rejectionReason,
        createdAt: fiscalEmissions.createdAt,
        completedAt: fiscalEmissions.completedAt,
      })
      .from(fiscalEmissions)
      .where(and(...conds))
      .orderBy(desc(fiscalEmissions.createdAt))
      .limit(parsed.limit)
    return { rows }
  },
)

// ─── getEmission ────────────────────────────────────────────────────────

export const getEmission = wrapServerAction(
  { module: 'fiscal', action: 'emission.read', resourceType: 'fiscal_emission' },
  async (input: z.infer<typeof EmissionIdSchema>, { session, setAuditResource }) => {
    const parsed = EmissionIdSchema.parse(input)
    const [row] = await db
      .select()
      .from(fiscalEmissions)
      .where(
        and(
          eq(fiscalEmissions.id, parsed.emissionId),
          eq(fiscalEmissions.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Emissão não encontrada',
        request_id: '',
      })
    const events = await db
      .select({
        id: fiscalEvents.id,
        kind: fiscalEvents.kind,
        status: fiscalEvents.status,
        justification: fiscalEvents.justification,
        rejectionReason: fiscalEvents.rejectionReason,
        createdAt: fiscalEvents.createdAt,
        completedAt: fiscalEvents.completedAt,
      })
      .from(fiscalEvents)
      .where(eq(fiscalEvents.emissionId, row.id))
      .orderBy(desc(fiscalEvents.createdAt))
    setAuditResource(row.id)
    return { emission: row, events }
  },
)

// ─── emitNfseFromInvoice ────────────────────────────────────────────────

export const emitNfseFromInvoice = wrapServerAction(
  { module: 'fiscal', action: 'emission.emit_nfse', resourceType: 'fiscal_emission' },
  async (input: z.infer<typeof EmitNfseFromInvoiceSchema>, { session, setAuditResource }) => {
    await requireFocusFlag()
    await requirePermission(session.logifit.userId, 'fiscal.emit')
    const parsed = EmitNfseFromInvoiceSchema.parse(input)
    // 1. Carrega invoice + valida estado
    const [inv] = await db
      .select({
        id: invoices.id,
        companyId: invoices.companyId,
        memberId: invoices.memberId,
        amountCents: invoices.amountCents,
        status: invoices.status,
      })
      .from(invoices)
      .where(
        and(eq(invoices.id, parsed.invoiceId), eq(invoices.tenantId, session.logifit.tenantId)),
      )
      .limit(1)
    if (!inv)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Invoice não encontrada',
        request_id: '',
      })
    if (inv.status !== 'paid')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'NFS-e só pode ser emitida sobre invoice paga',
        request_id: '',
      })

    // 2. Resolve company (CNPJ real) + serviço do catálogo (36b.2)
    const company = await resolveCompanyFiscal(session.logifit.tenantId, inv.companyId)
    const service = await resolveServiceCatalog(
      session.logifit.tenantId,
      inv.companyId,
      parsed.serviceCatalogId,
    )

    // 3. Reserva próximo número (serie 1 default — numeração custom Sprint 36c)
    const numero = await reserveNextNumero(session.logifit.tenantId, inv.companyId, 'nfse', 1)

    // 4. Resolve member + person pra recipient (endereço completo Sprint 36c)
    const [recipient] = await db
      .select({
        id: persons.id,
        displayName: persons.displayName,
        document: persons.document,
      })
      .from(persons)
      .innerJoin(
        sql`members`,
        sql`members.person_id = ${persons.id} AND members.id = ${inv.memberId}`,
      )
      .limit(1)
    if (!recipient?.document)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Member sem CPF/CNPJ no cadastro — NFS-e exige documento do tomador',
        request_id: '',
      })

    // 5. Provider call
    const provider = await getProviderForTenant(session.logifit.tenantId)
    const result = await provider.emitNfse({
      companyCnpj: company.cnpj,
      municipalityCode: service.municipalityCode,
      serie: 1,
      numero,
      recipient: {
        document: recipient.document,
        name: recipient.displayName ?? 'Cliente',
      },
      service: {
        lc116Code: service.lc116Code,
        cnae: service.cnae,
        description: `${service.description} — invoice ${inv.id.slice(0, 8)}`,
        valorTotalCents: inv.amountCents,
        issRateBp: service.issRateBp,
      },
      inscricaoMunicipal: company.im,
    })

    // 5. Persiste emissão
    const status = result.status === 'completed' ? 'completed' : 'queued'
    const [row] = await db
      .insert(fiscalEmissions)
      .values({
        tenantId: session.logifit.tenantId,
        companyId: inv.companyId,
        kind: 'nfse',
        status,
        provider: provider.name,
        sourceKind: 'invoice',
        sourceId: inv.id,
        serie: 1,
        numero,
        chave: result.chave,
        providerRef: result.providerRef,
        xmlStoragePath: result.xmlUrl ?? null,
        pdfStoragePath: result.pdfUrl ?? null,
        valorTotalCents: inv.amountCents,
        recipientPersonId: recipient?.id ?? null,
        recipientName: recipient?.displayName ?? null,
        recipientDocument: recipient?.document ?? null,
        payload: {
          input: {
            companyId: inv.companyId,
            memberId: inv.memberId,
            invoiceId: inv.id,
            serviceCatalogId: service.id,
          },
          result: result.raw,
        },
        submittedAt: new Date(),
        completedAt: status === 'completed' ? new Date() : null,
        cancelDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        createdByUserId: session.user.id,
      })
      .returning({ id: fiscalEmissions.id })

    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao gravar emissão',
        request_id: '',
      })

    setAuditResource(row.id, {
      invoiceId: inv.id,
      kind: 'nfse',
      provider: provider.name,
      valorTotalCents: inv.amountCents,
    })
    return {
      id: row.id,
      status,
      chave: result.chave,
      providerRef: result.providerRef,
    }
  },
)

// ─── emitNfseManual (avulsa — Sprint 36b.4) ─────────────────────────────

export const emitNfseManual = wrapServerAction(
  { module: 'fiscal', action: 'emission.emit_nfse_manual', resourceType: 'fiscal_emission' },
  async (input: z.infer<typeof EmitNfseManualSchema>, { session, setAuditResource }) => {
    await requireFocusFlag()
    await requirePermission(session.logifit.userId, 'fiscal.emit')
    const parsed = EmitNfseManualSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const recipientDocument = parsed.recipient.document.replace(/\D/g, '')
    if (recipientDocument.length !== 11 && recipientDocument.length !== 14)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Documento do tomador deve ser CPF (11) ou CNPJ (14 dígitos)',
        request_id: '',
      })

    const company = await resolveCompanyFiscal(tenantId, parsed.companyId)
    const service = await resolveServiceCatalog(tenantId, parsed.companyId, parsed.serviceCatalogId)
    const numero = await reserveNextNumero(tenantId, parsed.companyId, 'nfse', 1)

    const provider = await getProviderForTenant(tenantId)
    const result = await provider.emitNfse({
      companyCnpj: company.cnpj,
      municipalityCode: service.municipalityCode,
      serie: 1,
      numero,
      recipient: {
        document: recipientDocument,
        name: parsed.recipient.name,
        email: parsed.recipient.email ?? null,
      },
      service: {
        lc116Code: service.lc116Code,
        cnae: service.cnae,
        description: service.description,
        valorTotalCents: parsed.valorTotalCents,
        issRateBp: service.issRateBp,
      },
      notes: parsed.notes ?? null,
      inscricaoMunicipal: company.im,
    })

    const status = result.status === 'completed' ? 'completed' : 'queued'
    const [row] = await db
      .insert(fiscalEmissions)
      .values({
        tenantId,
        companyId: parsed.companyId,
        kind: 'nfse',
        status,
        provider: provider.name,
        sourceKind: 'manual',
        sourceId: null,
        serie: 1,
        numero,
        chave: result.chave,
        providerRef: result.providerRef,
        xmlStoragePath: result.xmlUrl ?? null,
        pdfStoragePath: result.pdfUrl ?? null,
        valorTotalCents: parsed.valorTotalCents,
        recipientPersonId: null,
        recipientName: parsed.recipient.name,
        recipientDocument,
        payload: {
          input: {
            companyId: parsed.companyId,
            serviceCatalogId: service.id,
            notes: parsed.notes ?? null,
          },
          result: result.raw,
        },
        submittedAt: new Date(),
        completedAt: status === 'completed' ? new Date() : null,
        cancelDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdByUserId: session.user.id,
      })
      .returning({ id: fiscalEmissions.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao gravar emissão',
        request_id: '',
      })

    setAuditResource(row.id, {
      kind: 'nfse',
      source: 'manual',
      provider: provider.name,
      valorTotalCents: parsed.valorTotalCents,
    })
    return { id: row.id, status, chave: result.chave, providerRef: result.providerRef }
  },
)

// ─── cancelEmission (MFA gate regra 43 — `cancelNfe`) ────────────────────

export const cancelEmission = wrapServerAction(
  { module: 'fiscal', action: 'cancelNfe', resourceType: 'fiscal_emission' },
  async (input: z.infer<typeof CancelEmissionSchema>, { session, setAuditResource }) => {
    await requireFocusFlag()
    await requirePermission(session.logifit.userId, 'fiscal.cancel')
    const parsed = CancelEmissionSchema.parse(input)
    const [em] = await db
      .select({
        id: fiscalEmissions.id,
        kind: fiscalEmissions.kind,
        status: fiscalEmissions.status,
        chave: fiscalEmissions.chave,
        providerRef: fiscalEmissions.providerRef,
        cancelDeadlineAt: fiscalEmissions.cancelDeadlineAt,
      })
      .from(fiscalEmissions)
      .where(
        and(
          eq(fiscalEmissions.id, parsed.emissionId),
          eq(fiscalEmissions.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!em)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Emissão não encontrada',
        request_id: '',
      })
    if (em.status !== 'completed')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Não é possível cancelar emissão em status '${em.status}'`,
        request_id: '',
      })
    if (!em.chave || !em.providerRef)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Emissão sem chave/ref do provider — cancelamento impossível',
        request_id: '',
      })
    if (em.cancelDeadlineAt && em.cancelDeadlineAt < new Date())
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Janela de cancelamento (24h) expirada — use estorno via NF-e devolução',
        request_id: '',
      })

    const provider = await getProviderForTenant(session.logifit.tenantId)
    const result = await provider.cancel({
      providerRef: em.providerRef,
      chave: em.chave,
      justification: parsed.justification,
      kind: em.kind,
    })

    // Transação: insere evento + marca emission cancelled
    await db.transaction(async (tx) => {
      await tx.insert(fiscalEvents).values({
        tenantId: session.logifit.tenantId,
        emissionId: em.id,
        kind: 'cancellation',
        providerRef: result.providerRef,
        justification: parsed.justification,
        status: result.status === 'completed' ? 'completed' : 'queued',
        payload: result.raw,
        submittedAt: new Date(),
        completedAt: result.status === 'completed' ? new Date() : null,
        createdByUserId: session.user.id,
      })
      if (result.status === 'completed') {
        await tx
          .update(fiscalEmissions)
          .set({
            status: 'cancelled',
            cancelledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(fiscalEmissions.id, em.id))
      }
    })

    setAuditResource(em.id, {
      eventKind: 'cancellation',
      providerRef: result.providerRef,
      justification: parsed.justification.slice(0, 80),
    })
    return { ok: true as const, status: result.status }
  },
)

// ─── issueCce (MFA gate regra 43) ────────────────────────────────────────

export const issueCce = wrapServerAction(
  { module: 'fiscal', action: 'issueCce', resourceType: 'fiscal_emission' },
  async (input: z.infer<typeof IssueCceSchema>, { session, setAuditResource }) => {
    await requireFocusFlag()
    await requirePermission(session.logifit.userId, 'fiscal.cancel')
    const parsed = IssueCceSchema.parse(input)
    const [em] = await db
      .select({
        id: fiscalEmissions.id,
        kind: fiscalEmissions.kind,
        status: fiscalEmissions.status,
        chave: fiscalEmissions.chave,
        providerRef: fiscalEmissions.providerRef,
      })
      .from(fiscalEmissions)
      .where(
        and(
          eq(fiscalEmissions.id, parsed.emissionId),
          eq(fiscalEmissions.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!em)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Emissão não encontrada',
        request_id: '',
      })
    if (em.status !== 'completed')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'CC-e exige emissão completed',
        request_id: '',
      })
    // CC-e só pra NF-e modelo 55; NFS-e e NFC-e não têm CC-e
    if (em.kind !== 'nfe' && em.kind !== 'nfe_return' && em.kind !== 'nfe_transfer') {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `CC-e indisponível pra ${em.kind}`,
        request_id: '',
      })
    }
    if (!em.chave || !em.providerRef)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Emissão sem chave/ref',
        request_id: '',
      })

    // Sprint 36b: contar CC-e existentes pra setar sequence (max 30 por chave)
    const existingCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(fiscalEvents)
      .where(
        and(
          eq(fiscalEvents.emissionId, em.id),
          eq(fiscalEvents.kind, 'cce'),
          eq(fiscalEvents.status, 'completed'),
        ),
      )
    const nextSequence = (existingCount[0]?.count ?? 0) + 1
    if (nextSequence > 30)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Limite de 30 CC-e por chave excedido',
        request_id: '',
      })

    const provider = await getProviderForTenant(session.logifit.tenantId)
    const result = await provider.issueCce({
      providerRef: em.providerRef,
      chave: em.chave,
      correction: parsed.correction,
      sequence: nextSequence,
    })

    const [row] = await db
      .insert(fiscalEvents)
      .values({
        tenantId: session.logifit.tenantId,
        emissionId: em.id,
        kind: 'cce',
        providerRef: result.providerRef,
        justification: parsed.correction,
        status: result.status === 'completed' ? 'completed' : 'queued',
        payload: { sequence: nextSequence, result: result.raw },
        submittedAt: new Date(),
        completedAt: result.status === 'completed' ? new Date() : null,
        createdByUserId: session.user.id,
      })
      .returning({ id: fiscalEvents.id })

    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Insert de fiscal_events não retornou id',
        request_id: '',
      })
    setAuditResource(row.id, {
      emissionId: em.id,
      sequence: nextSequence,
      correction: parsed.correction.slice(0, 80),
    })
    return { ok: true as const, eventId: row.id, sequence: nextSequence }
  },
)

// ─── inutilizeRange (MFA gate regra 43) ──────────────────────────────────

export const inutilizeRange = wrapServerAction(
  { module: 'fiscal', action: 'inutilizeRange', resourceType: 'fiscal_event' },
  async (input: z.infer<typeof InutilizeRangeSchema>, { session, setAuditResource }) => {
    await requireFocusFlag()
    await requirePermission(session.logifit.userId, 'fiscal.cancel')
    const parsed = InutilizeRangeSchema.parse(input)
    if (parsed.numeroFrom > parsed.numeroTo)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'numeroFrom > numeroTo',
        request_id: '',
      })

    const company = await resolveCompanyFiscal(session.logifit.tenantId, parsed.companyId)
    const provider = await getProviderForTenant(session.logifit.tenantId)
    const result = await provider.inutilize({
      companyCnpj: company.cnpj,
      emissionKind: parsed.emissionKind,
      serie: parsed.serie,
      numeroFrom: parsed.numeroFrom,
      numeroTo: parsed.numeroTo,
      justification: parsed.justification,
      year: parsed.year,
    })

    const [row] = await db
      .insert(fiscalEvents)
      .values({
        tenantId: session.logifit.tenantId,
        emissionId: null,
        kind: 'inutilizacao',
        providerRef: result.providerRef,
        companyId: parsed.companyId,
        emissionKind: parsed.emissionKind,
        serie: parsed.serie,
        numeroFrom: parsed.numeroFrom,
        numeroTo: parsed.numeroTo,
        justification: parsed.justification,
        status: result.status === 'completed' ? 'completed' : 'queued',
        payload: { year: parsed.year, result: result.raw },
        submittedAt: new Date(),
        completedAt: result.status === 'completed' ? new Date() : null,
        createdByUserId: session.user.id,
      })
      .returning({ id: fiscalEvents.id })

    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Insert de fiscal_events não retornou id',
        request_id: '',
      })
    setAuditResource(row.id, {
      companyId: parsed.companyId,
      kind: parsed.emissionKind,
      serie: parsed.serie,
      numeroFrom: parsed.numeroFrom,
      numeroTo: parsed.numeroTo,
    })
    return { ok: true as const, eventId: row.id }
  },
)

// ─── queryEmissionStatus ────────────────────────────────────────────────

export const queryEmissionStatus = wrapServerAction(
  {
    module: 'fiscal',
    action: 'emission.query_status',
    resourceType: 'fiscal_emission',
  },
  async (input: z.infer<typeof EmissionIdSchema>, { session, setAuditResource }) => {
    const parsed = EmissionIdSchema.parse(input)
    const [em] = await db
      .select({
        id: fiscalEmissions.id,
        kind: fiscalEmissions.kind,
        status: fiscalEmissions.status,
        providerRef: fiscalEmissions.providerRef,
      })
      .from(fiscalEmissions)
      .where(
        and(
          eq(fiscalEmissions.id, parsed.emissionId),
          eq(fiscalEmissions.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!em)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Emissão não encontrada',
        request_id: '',
      })
    if (!em.providerRef)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Emissão sem provider_ref (ainda não enviada)',
        request_id: '',
      })

    const provider = await getProviderForTenant(session.logifit.tenantId)
    const result = await provider.queryStatus(em.providerRef, em.kind)

    // Atualiza status local se provider retornar mudança
    if (result.status !== em.status) {
      await db
        .update(fiscalEmissions)
        .set({
          status:
            result.status === 'completed'
              ? 'completed'
              : result.status === 'rejected'
                ? 'rejected'
                : em.status,
          chave: result.chave ?? sql`chave`,
          xmlStoragePath: result.xmlUrl ?? sql`xml_storage_path`,
          pdfStoragePath: result.pdfUrl ?? sql`pdf_storage_path`,
          completedAt: result.status === 'completed' ? new Date() : sql`completed_at`,
          rejectionReason: result.rejectionReason ?? sql`rejection_reason`,
          updatedAt: new Date(),
        })
        .where(eq(fiscalEmissions.id, em.id))
    }

    setAuditResource(em.id, {
      oldStatus: em.status,
      newStatus: result.status,
    })
    return { status: result.status, chave: result.chave }
  },
)

// ─── retryEmission ──────────────────────────────────────────────────────

export const retryEmission = wrapServerAction(
  { module: 'fiscal', action: 'emission.retry', resourceType: 'fiscal_emission' },
  async (input: z.infer<typeof EmissionIdSchema>, { session, setAuditResource }) => {
    await requireFocusFlag()
    await requirePermission(session.logifit.userId, 'fiscal.emit')
    const parsed = EmissionIdSchema.parse(input)
    const [em] = await db
      .select()
      .from(fiscalEmissions)
      .where(
        and(
          eq(fiscalEmissions.id, parsed.emissionId),
          eq(fiscalEmissions.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!em)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Emissão não encontrada',
        request_id: '',
      })
    if (em.status !== 'rejected')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Retry só em emissões rejected',
        request_id: '',
      })
    if (em.retryCount >= 3)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Limite de 3 retries excedido — emissão precisa intervenção manual',
        request_id: '',
      })

    // Sprint 36b: reconstroi payload com payload original + reenvia.
    // MVP backbone: apenas incrementa retry_count e marca queued.
    await db
      .update(fiscalEmissions)
      .set({
        status: 'queued',
        retryCount: em.retryCount + 1,
        rejectionReason: null,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(fiscalEmissions.id, em.id))

    setAuditResource(em.id, { retryCount: em.retryCount + 1 })
    return { ok: true as const, retryCount: em.retryCount + 1 }
  },
)
