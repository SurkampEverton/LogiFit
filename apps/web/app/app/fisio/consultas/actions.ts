'use server'

/**
 * Server Actions Prontuário Fisio — Sprint 20 Faixa B.2 (ADR 0028 + ADR 0032 Accepted).
 *
 * Cobertura MVP:
 *   - createConsulta(memberId, kind, appointmentId?, templateTypeId?, content?)
 *   - updateConsultaContent(id, content) — só em draft
 *   - linkCid(consultaId, cidCode, kind)
 *   - linkCif(consultaId, cifCode, qualifier)
 *   - lockConsulta(id, attempt: 'icp_brasil_a1'|'icp_brasil_a3'|'authenticated_mfa')
 *     — valida `signature_policies` + tenant override + MFA recente + council ativo (ADR 0055)
 *     — calcula hash + grava signed_at + status='locked' ou 'signed'
 *   - createCorrectionNote(consultaId, body, reason)
 *   - exportPdfStub(consultaId) — placeholder, Sprint 20b implementa @react-pdf/renderer
 *
 * **ICP-Brasil real** (Cert.Sign/Bry/Vaultsign) fica Sprint 20b — neste sprint
 * o `lockMethod='icp_brasil_a3'` é aceito mas não verifica cert externamente
 * (placeholder; ADR 0041 esperado pra escolher provider).
 */

import {
  hashConsultaContent,
  resolveSignaturePolicy,
  validateCidCode,
  validateCifCode,
  validateCifQualifier,
  validateLockAttempt,
  type LockMethod,
  type SignaturePolicyRow,
  type TenantSignatureOverrideRow,
} from '@repo/db/fisio'
import {
  cidCatalog,
  cifCatalog,
  consultaCids,
  consultaCifs,
  consultaCorrectionNotes,
  consultas,
  members,
  professionalRegistrations,
  signaturePolicies,
  tenantSignatureOverrides,
  users,
} from '@repo/db/schema'
import { db } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const KindEnum = z.enum(['medico', 'fisio', 'nutri', 'personal', 'enfermeiro', 'custom'])

const CreateConsultaInputSchema = z.object({
  memberId: z.string().uuid(),
  kind: KindEnum,
  appointmentId: z.string().uuid().optional().nullable(),
  templateTypeId: z.string().uuid().optional().nullable(),
  content: z.record(z.string(), z.unknown()).default({}),
})

const UpdateConsultaInputSchema = z.object({
  consultaId: z.string().uuid(),
  content: z.record(z.string(), z.unknown()),
})

const LinkCidInputSchema = z.object({
  consultaId: z.string().uuid(),
  cidCode: z.string().min(2).max(12),
  kind: z.enum(['principal', 'secundario']).default('principal'),
  notes: z.string().max(2000).optional().nullable(),
})

const LinkCifInputSchema = z.object({
  consultaId: z.string().uuid(),
  cifCode: z.string().min(2).max(20),
  qualifier: z.number().int().min(0).max(4),
  notes: z.string().max(2000).optional().nullable(),
})

const LockConsultaInputSchema = z.object({
  consultaId: z.string().uuid(),
  attempt: z.enum(['icp_brasil_a1', 'icp_brasil_a3', 'authenticated_mfa']),
  signatureProvider: z.string().max(80).optional().nullable(),
})

const CorrectionNoteInputSchema = z.object({
  consultaId: z.string().uuid(),
  body: z.string().min(5).max(5000),
  reason: z.string().min(3).max(500),
})

// ─── Helpers ─────────────────────────────────────────────────────────────

function kindToProfession(kind: string): string {
  // 1:1 atualmente, mas reservado pra mapeamento custom
  return kind === 'custom' ? 'fisio' : kind
}

function professionToCouncil(profession: string): string | null {
  switch (profession) {
    case 'medico':
      return 'CRM'
    case 'fisio':
      return 'CREFITO'
    case 'nutri':
      return 'CRN'
    case 'personal':
      return 'CREF'
    case 'enfermeiro':
      return 'COREN'
    default:
      return null
  }
}

async function loadPoliciesAndOverrides(tenantId: string): Promise<{
  policies: SignaturePolicyRow[]
  overrides: TenantSignatureOverrideRow[]
}> {
  const pols = await db
    .select({
      profession: signaturePolicies.profession,
      mode: signaturePolicies.mode,
      minCertLevel: signaturePolicies.minCertLevel,
      requiresMfa: signaturePolicies.requiresMfa,
      requiresAuditChain: signaturePolicies.requiresAuditChain,
      requiresAuthenticatedSession: signaturePolicies.requiresAuthenticatedSession,
      sourceNorm: signaturePolicies.sourceNorm,
      retentionYears: signaturePolicies.retentionYears,
    })
    .from(signaturePolicies)
  const ovs = await db
    .select({
      tenantId: tenantSignatureOverrides.tenantId,
      profession: tenantSignatureOverrides.profession,
      modeOverride: tenantSignatureOverrides.modeOverride,
    })
    .from(tenantSignatureOverrides)
    .where(eq(tenantSignatureOverrides.tenantId, tenantId))
  return {
    policies: pols.map((p) => ({
      ...p,
      minCertLevel: (p.minCertLevel as 'A1' | 'A3' | null) ?? null,
    })),
    overrides: ovs,
  }
}

// ─── createConsulta ──────────────────────────────────────────────────────

export const createConsulta = wrapServerAction(
  { module: 'fisio', action: 'consulta.create', resourceType: 'consultas' },
  async (input: z.infer<typeof CreateConsultaInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateConsultaInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Member precisa pertencer ao tenant + extrair company
    const [member] = await db
      .select({ id: members.id, companyId: members.companyId })
      .from(members)
      .where(and(eq(members.id, parsed.memberId), eq(members.tenantId, tenantId)))
      .limit(1)
    if (!member)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })

    // Política inicial pra cachear signature_mode
    const { policies, overrides } = await loadPoliciesAndOverrides(tenantId)
    const policy = resolveSignaturePolicy({
      professionOrKind: parsed.kind,
      policies,
      tenantOverrides: overrides,
      tenantId,
    })

    const [row] = await db
      .insert(consultas)
      .values({
        tenantId,
        companyId: member.companyId,
        memberId: parsed.memberId,
        appointmentId: parsed.appointmentId ?? null,
        professionalUserId: session.user.id,
        kind: parsed.kind,
        templateTypeId: parsed.templateTypeId ?? null,
        content: parsed.content,
        signatureMode: policy.mode,
        status: 'draft',
      })
      .returning({ id: consultas.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar consulta',
        request_id: '',
      })
    setAuditResource(row.id, { memberId: parsed.memberId, kind: parsed.kind })
    return { id: row.id, signatureMode: policy.mode }
  },
)

// ─── updateConsultaContent (só em draft) ────────────────────────────────

export const updateConsultaContent = wrapServerAction(
  { module: 'fisio', action: 'consulta.update', resourceType: 'consultas' },
  async (input: z.infer<typeof UpdateConsultaInputSchema>, { session, setAuditResource }) => {
    const parsed = UpdateConsultaInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [current] = await db
      .select({ id: consultas.id, status: consultas.status })
      .from(consultas)
      .where(and(eq(consultas.id, parsed.consultaId), eq(consultas.tenantId, tenantId)))
      .limit(1)
    if (!current)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Consulta não encontrada',
        request_id: '',
      })
    if (current.status !== 'draft')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Consulta já fechada — crie nota corretiva para mudanças',
        request_id: '',
      })

    await db
      .update(consultas)
      .set({ content: parsed.content, updatedAt: new Date() })
      .where(eq(consultas.id, parsed.consultaId))
    setAuditResource(parsed.consultaId, {})
    return { ok: true }
  },
)

// ─── linkCid ──────────────────────────────────────────────────────────────

export const linkCid = wrapServerAction(
  { module: 'fisio', action: 'consulta.link_cid', resourceType: 'consulta_cids' },
  async (input: z.infer<typeof LinkCidInputSchema>, { session, setAuditResource }) => {
    const parsed = LinkCidInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const cidCheck = validateCidCode(parsed.cidCode)
    if (!cidCheck.ok)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: cidCheck.reason ?? 'CID inválido',
        request_id: '',
      })

    // Valida consulta + status
    const [c] = await db
      .select({ id: consultas.id, status: consultas.status })
      .from(consultas)
      .where(and(eq(consultas.id, parsed.consultaId), eq(consultas.tenantId, tenantId)))
      .limit(1)
    if (!c)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Consulta não encontrada',
        request_id: '',
      })
    if (c.status !== 'draft')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Não é possível adicionar CID após fechamento — use nota corretiva',
        request_id: '',
      })

    // Valida CID existe no catálogo
    const [cid] = await db
      .select({ code: cidCatalog.code })
      .from(cidCatalog)
      .where(eq(cidCatalog.code, parsed.cidCode))
      .limit(1)
    if (!cid)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `CID ${parsed.cidCode} não está no catálogo CID-11`,
        request_id: '',
      })

    try {
      await db.insert(consultaCids).values({
        consultaId: parsed.consultaId,
        cidCode: parsed.cidCode,
        kind: parsed.kind,
        notes: parsed.notes ?? null,
      })
      setAuditResource(parsed.consultaId, { cidCode: parsed.cidCode })
      return { ok: true }
    } catch (err) {
      const code =
        (err as { code?: string; cause?: { code?: string } }).code ??
        (err as { cause?: { code?: string } }).cause?.code ??
        ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'CID já vinculado a essa consulta com esse tipo',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── linkCif ──────────────────────────────────────────────────────────────

export const linkCif = wrapServerAction(
  { module: 'fisio', action: 'consulta.link_cif', resourceType: 'consulta_cifs' },
  async (input: z.infer<typeof LinkCifInputSchema>, { session, setAuditResource }) => {
    const parsed = LinkCifInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const cifCheck = validateCifCode(parsed.cifCode)
    if (!cifCheck.ok)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: cifCheck.reason ?? 'CIF inválido',
        request_id: '',
      })
    const qCheck = validateCifQualifier(parsed.qualifier)
    if (!qCheck.ok)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: qCheck.reason ?? 'Qualifier inválido',
        request_id: '',
      })

    const [c] = await db
      .select({ id: consultas.id, status: consultas.status })
      .from(consultas)
      .where(and(eq(consultas.id, parsed.consultaId), eq(consultas.tenantId, tenantId)))
      .limit(1)
    if (!c)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Consulta não encontrada',
        request_id: '',
      })
    if (c.status !== 'draft')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Não é possível adicionar CIF após fechamento — use nota corretiva',
        request_id: '',
      })

    const [cif] = await db
      .select({ code: cifCatalog.code })
      .from(cifCatalog)
      .where(eq(cifCatalog.code, parsed.cifCode))
      .limit(1)
    if (!cif)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `CIF ${parsed.cifCode} não está no catálogo`,
        request_id: '',
      })

    try {
      await db.insert(consultaCifs).values({
        consultaId: parsed.consultaId,
        cifCode: parsed.cifCode,
        qualifier: parsed.qualifier,
        notes: parsed.notes ?? null,
      })
      setAuditResource(parsed.consultaId, { cifCode: parsed.cifCode })
      return { ok: true }
    } catch (err) {
      const code =
        (err as { code?: string; cause?: { code?: string } }).code ??
        (err as { cause?: { code?: string } }).cause?.code ??
        ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'CIF já vinculado',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── lockConsulta ────────────────────────────────────────────────────────

export const lockConsulta = wrapServerAction(
  { module: 'fisio', action: 'consulta.lock', resourceType: 'consultas' },
  async (input: z.infer<typeof LockConsultaInputSchema>, { session, setAuditResource }) => {
    const parsed = LockConsultaInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [c] = await db
      .select({
        id: consultas.id,
        kind: consultas.kind,
        status: consultas.status,
        content: consultas.content,
        professionalUserId: consultas.professionalUserId,
        signatureMode: consultas.signatureMode,
      })
      .from(consultas)
      .where(and(eq(consultas.id, parsed.consultaId), eq(consultas.tenantId, tenantId)))
      .limit(1)
    if (!c)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Consulta não encontrada',
        request_id: '',
      })
    if (c.status !== 'draft')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Consulta já fechada',
        request_id: '',
      })

    // Profissional precisa ser o autor (regra negocial)
    if (c.professionalUserId !== session.user.id)
      throw new ApiException({
        code: 'FORBIDDEN',
        message: 'Apenas o profissional autor pode fechar a consulta',
        request_id: '',
      })

    // Carrega política e overrides
    const { policies, overrides } = await loadPoliciesAndOverrides(tenantId)
    const policy = resolveSignaturePolicy({
      professionOrKind: c.kind,
      policies,
      tenantOverrides: overrides,
      tenantId,
    })

    // Gate ADR 0055 — registro profissional ativo coerente com kind
    const profession = kindToProfession(c.kind)
    const expectedCouncil = professionToCouncil(profession)
    const [profUser] = await db
      .select({ personId: users.personId })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1)
    let hasActiveCouncil = expectedCouncil == null // 'custom' sem council = não-clínico
    let councilSnapshot: Record<string, unknown> | null = null
    if (profUser && expectedCouncil) {
      const regs = await db
        .select({
          councilBody: professionalRegistrations.councilBody,
          councilState: professionalRegistrations.councilState,
          councilNumber: professionalRegistrations.councilNumber,
          situation: professionalRegistrations.situation,
        })
        .from(professionalRegistrations)
        .where(
          and(
            eq(professionalRegistrations.tenantId, tenantId),
            eq(professionalRegistrations.personId, profUser.personId),
          ),
        )
      const matching = regs.find(
        (r) => r.councilBody === expectedCouncil && r.situation === 'active',
      )
      if (matching) {
        hasActiveCouncil = true
        councilSnapshot = {
          councilBody: matching.councilBody,
          councilState: matching.councilState,
          councilNumber: matching.councilNumber,
        }
      }
    }

    // Valida tentativa
    const mfaAt = session.logifit.mfaAt
    const mfaRecentMs = mfaAt ? Date.now() - new Date(mfaAt).getTime() : undefined
    const validation = validateLockAttempt({
      policy,
      attempt: parsed.attempt,
      mfaRecentMs,
      hasActiveCouncil,
    })
    if (!validation.ok)
      throw new ApiException({
        code: 'FORBIDDEN',
        message: validation.reason,
        request_id: '',
      })

    // Carrega CIDs + CIFs pra incluir no hash (regra 39 base)
    const cids = await db
      .select({ code: consultaCids.cidCode, kind: consultaCids.kind })
      .from(consultaCids)
      .where(eq(consultaCids.consultaId, c.id))
    const cifs = await db
      .select({ code: consultaCifs.cifCode, qualifier: consultaCifs.qualifier })
      .from(consultaCifs)
      .where(eq(consultaCifs.consultaId, c.id))

    // Exige ao menos 1 CID principal (regra clínica)
    const hasPrincipalCid = cids.some((c) => c.kind === 'principal')
    if (!hasPrincipalCid) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Consulta exige pelo menos 1 CID principal antes do fechamento',
        request_id: '',
      })
    }

    const now = new Date()
    const lockMethod: LockMethod = validation.lockMethod
    const isSignedWithIcp =
      lockMethod === 'icp_brasil_a1' || lockMethod === 'icp_brasil_a3'
    const newStatus = isSignedWithIcp ? 'signed' : 'locked'
    const contentHash = hashConsultaContent({
      content: (c.content as Record<string, unknown>) ?? {},
      cids,
      cifs,
      signedAtIso: now.toISOString(),
      professionalUserId: session.user.id,
    })

    await db
      .update(consultas)
      .set({
        status: newStatus,
        lockMethod,
        lockedAt: now,
        lockedByUserId: session.user.id,
        signedAt: isSignedWithIcp ? now : null,
        signedHash: contentHash, // hash da Lacre/Assinatura (regra 39)
        signatureProvider: parsed.signatureProvider ?? null,
        councilSnapshot: councilSnapshot ?? undefined,
        councilBodyAtSign: expectedCouncil ?? null,
        updatedAt: now,
      })
      .where(eq(consultas.id, c.id))

    setAuditResource(c.id, {
      lockMethod,
      newStatus,
      isSigned: isSignedWithIcp,
      contentHash,
    })
    return {
      ok: true,
      status: newStatus,
      lockMethod,
      signedHash: contentHash,
    }
  },
)

// ─── createCorrectionNote ────────────────────────────────────────────────

export const createCorrectionNote = wrapServerAction(
  {
    module: 'fisio',
    action: 'consulta.correction_note',
    resourceType: 'consulta_correction_notes',
  },
  async (input: z.infer<typeof CorrectionNoteInputSchema>, { session, setAuditResource }) => {
    const parsed = CorrectionNoteInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [c] = await db
      .select({ id: consultas.id, status: consultas.status })
      .from(consultas)
      .where(and(eq(consultas.id, parsed.consultaId), eq(consultas.tenantId, tenantId)))
      .limit(1)
    if (!c)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Consulta não encontrada',
        request_id: '',
      })
    if (c.status === 'draft')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Nota corretiva só após fechamento — edite o draft diretamente',
        request_id: '',
      })

    // Hash do corpo da nota — entra na hash chain via audit_log
    const contentHash = hashConsultaContent({
      content: { body: parsed.body, reason: parsed.reason },
      cids: [],
      cifs: [],
      signedAtIso: new Date().toISOString(),
      professionalUserId: session.user.id,
    })

    const [row] = await db
      .insert(consultaCorrectionNotes)
      .values({
        tenantId,
        consultaId: parsed.consultaId,
        body: parsed.body,
        reason: parsed.reason,
        authorUserId: session.user.id,
        contentHash,
      })
      .returning({ id: consultaCorrectionNotes.id })
    setAuditResource(row!.id, { consultaId: parsed.consultaId })
    return { id: row!.id, contentHash }
  },
)

// ─── listConsultasByMember ───────────────────────────────────────────────

export const listConsultasByMember = wrapServerAction(
  { module: 'fisio', action: 'consulta.list_by_member' },
  async (input: { memberId: string; limit?: number }, { session }) => {
    const parsed = z
      .object({ memberId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(50) })
      .parse(input)
    const tenantId = session.logifit.tenantId
    const rows = await db
      .select({
        id: consultas.id,
        kind: consultas.kind,
        status: consultas.status,
        signatureMode: consultas.signatureMode,
        lockMethod: consultas.lockMethod,
        signedAt: consultas.signedAt,
        signedHash: consultas.signedHash,
        signatureProvider: consultas.signatureProvider,
        lockedAt: consultas.lockedAt,
        createdAt: consultas.createdAt,
        professionalUserId: consultas.professionalUserId,
      })
      .from(consultas)
      .where(
        and(
          eq(consultas.tenantId, tenantId),
          eq(consultas.memberId, parsed.memberId),
          isNull(consultas.archivedAt),
        ),
      )
      .orderBy(desc(consultas.createdAt))
      .limit(parsed.limit)
    return { consultas: rows }
  },
)

// ─── listCidCatalog (read-all) ───────────────────────────────────────────

export const listCidCatalog = wrapServerAction(
  { module: 'fisio', action: 'cid.list' },
  async (input: { query?: string; limit?: number } | undefined, { session: _session }) => {
    const parsed = z
      .object({ query: z.string().max(80).optional(), limit: z.number().int().min(1).max(200).default(50) })
      .parse(input ?? {})
    const where = [eq(cidCatalog.active, true)]
    if (parsed.query) {
      where.push(
        sql`(${cidCatalog.code} ILIKE ${'%' + parsed.query + '%'} OR ${cidCatalog.description} ILIKE ${'%' + parsed.query + '%'})`,
      )
    }
    const rows = await db
      .select()
      .from(cidCatalog)
      .where(and(...where))
      .orderBy(asc(cidCatalog.code))
      .limit(parsed.limit)
    return { cids: rows }
  },
)

// ─── listCifCatalog (read-all) ───────────────────────────────────────────

export const listCifCatalog = wrapServerAction(
  { module: 'fisio', action: 'cif.list' },
  async (input: { query?: string; component?: string; limit?: number } | undefined, { session: _session }) => {
    const parsed = z
      .object({
        query: z.string().max(80).optional(),
        component: z
          .enum(['body_functions', 'body_structures', 'activities_participation', 'environmental_factors'])
          .optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(input ?? {})
    const where = [eq(cifCatalog.active, true)]
    if (parsed.component) where.push(eq(cifCatalog.component, parsed.component))
    if (parsed.query) {
      where.push(
        sql`(${cifCatalog.code} ILIKE ${'%' + parsed.query + '%'} OR ${cifCatalog.description} ILIKE ${'%' + parsed.query + '%'})`,
      )
    }
    const rows = await db
      .select()
      .from(cifCatalog)
      .where(and(...where))
      .orderBy(asc(cifCatalog.code))
      .limit(parsed.limit)
    return { cifs: rows }
  },
)

// ─── exportPdfStub (Sprint 20b implementa @react-pdf/renderer real) ─────

export const exportPdfStub = wrapServerAction(
  { module: 'fisio', action: 'consulta.export_pdf' },
  async (_input: { consultaId: string }, { session: _session }) => {
    throw new ApiException({
      code: 'INTERNAL_ERROR',
      message:
        'Export PDF assinado chega no Sprint 20b (@react-pdf/renderer + carimbo ICP). MVP mostra preview HTML readonly em /pdf.',
      request_id: '',
    })
  },
)
