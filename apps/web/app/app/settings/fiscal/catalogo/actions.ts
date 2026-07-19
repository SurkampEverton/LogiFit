'use server'

/**
 * Server Actions — catálogo de serviços tributáveis (Sprint 36b.3, ADR 0059).
 *
 * `fiscal_service_catalog` alimenta a emissão de NFS-e (`resolveServiceCatalog`):
 * código IBGE do município, item LC 116/2003, CNAE, alíquota ISS. Gate
 * `fiscal.admin` em todas — configuração fiscal é alto impacto.
 *
 * Sem DELETE físico: desativar (`active=false`) preserva histórico de emissões
 * que referenciam o serviço no payload.
 */

import { db } from '@repo/db/client'
import { companies, fiscalServiceCatalog, persons } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../../../../lib/permissions'
import { wrapServerAction } from '../../../../lib/wrap-action'

const SaveServiceSchema = z.object({
  /** Ausente = criar; presente = atualizar */
  id: z.string().uuid().optional(),
  companyId: z.string().uuid(),
  /** Código IBGE 7 dígitos */
  municipalityCode: z.string().regex(/^\d{7}$/, 'Código IBGE deve ter 7 dígitos'),
  /** Item LC 116/2003 — "X.YY" (ex: 8.02) */
  lc116Code: z
    .string()
    .regex(/^\d{1,2}\.\d{2}$/, 'Formato LC 116: X.YY (ex: 8.02)')
    .nullable()
    .optional(),
  cnae: z.string().max(12).nullable().optional(),
  description: z.string().min(3).max(200),
  taxRegime: z.enum(['simples_nacional', 'lucro_presumido', 'lucro_real', 'mei']),
  /** Basis points: 200 = 2,00%. ISS municipal fica entre 2% e 5% (LC 116 art. 8-A). */
  issRateBp: z.number().int().min(200).max(500),
})

const ServiceIdSchema = z.object({ id: z.string().uuid() })

export const listServiceCatalog = wrapServerAction(
  {
    module: 'fiscal',
    action: 'catalog.list',
    resourceType: 'fiscal_service_catalog',
  },
  async (_input: Record<string, never>, { session }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const rows = await db
      .select({
        id: fiscalServiceCatalog.id,
        companyId: fiscalServiceCatalog.companyId,
        companyName: persons.name,
        municipalityCode: fiscalServiceCatalog.municipalityCode,
        lc116Code: fiscalServiceCatalog.lc116Code,
        cnae: fiscalServiceCatalog.cnae,
        description: fiscalServiceCatalog.description,
        taxRegime: fiscalServiceCatalog.taxRegime,
        issRateBp: fiscalServiceCatalog.issRateBp,
        active: fiscalServiceCatalog.active,
      })
      .from(fiscalServiceCatalog)
      .innerJoin(companies, eq(companies.id, fiscalServiceCatalog.companyId))
      .innerJoin(persons, eq(persons.id, companies.personId))
      .where(eq(fiscalServiceCatalog.tenantId, session.logifit.tenantId))
      .orderBy(asc(fiscalServiceCatalog.description))
    return { rows }
  },
)

export const saveServiceCatalogItem = wrapServerAction(
  {
    module: 'fiscal',
    action: 'catalog.save',
    resourceType: 'fiscal_service_catalog',
  },
  async (input: z.infer<typeof SaveServiceSchema>, { session, setAuditResource }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const parsed = SaveServiceSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Company precisa ser do tenant (defesa além da RLS)
    const [company] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, parsed.companyId), eq(companies.tenantId, tenantId)))
      .limit(1)
    if (!company)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Empresa não encontrada neste tenant',
        request_id: '',
      })

    const values = {
      companyId: parsed.companyId,
      municipalityCode: parsed.municipalityCode,
      lc116Code: parsed.lc116Code ?? null,
      cnae: parsed.cnae?.replace(/\D/g, '') || null,
      description: parsed.description,
      taxRegime: parsed.taxRegime,
      issRateBp: parsed.issRateBp,
      updatedAt: new Date(),
    }

    if (parsed.id) {
      const [updated] = await db
        .update(fiscalServiceCatalog)
        .set(values)
        .where(
          and(eq(fiscalServiceCatalog.id, parsed.id), eq(fiscalServiceCatalog.tenantId, tenantId)),
        )
        .returning({ id: fiscalServiceCatalog.id })
      if (!updated)
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Serviço não encontrado',
          request_id: '',
        })
      setAuditResource(updated.id, { action: 'update', description: parsed.description })
      return { id: updated.id, created: false }
    }

    const [created] = await db
      .insert(fiscalServiceCatalog)
      .values({ tenantId, ...values })
      .returning({ id: fiscalServiceCatalog.id })
    if (!created)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Insert do catálogo não retornou id',
        request_id: '',
      })
    setAuditResource(created.id, { action: 'create', description: parsed.description })
    return { id: created.id, created: true }
  },
)

export const toggleServiceCatalogItem = wrapServerAction(
  {
    module: 'fiscal',
    action: 'catalog.toggle',
    resourceType: 'fiscal_service_catalog',
  },
  async (input: z.infer<typeof ServiceIdSchema>, { session, setAuditResource }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const parsed = ServiceIdSchema.parse(input)
    const [row] = await db
      .select({ active: fiscalServiceCatalog.active })
      .from(fiscalServiceCatalog)
      .where(
        and(
          eq(fiscalServiceCatalog.id, parsed.id),
          eq(fiscalServiceCatalog.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Serviço não encontrado',
        request_id: '',
      })
    const next = !row.active
    await db
      .update(fiscalServiceCatalog)
      .set({ active: next, updatedAt: new Date() })
      .where(
        and(
          eq(fiscalServiceCatalog.id, parsed.id),
          eq(fiscalServiceCatalog.tenantId, session.logifit.tenantId),
        ),
      )
    setAuditResource(parsed.id, { action: next ? 'activate' : 'deactivate' })
    return { id: parsed.id, active: next }
  },
)
