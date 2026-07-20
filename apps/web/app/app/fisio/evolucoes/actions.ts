'use server'

/**
 * Server Actions Evolução de sessão fisio — Sprint 21 Faixa B.2.
 *
 * MVP (sem upload real no Server Action — UI faz via API Route quando habilitado):
 *   - createEvolucao(memberId, appointmentId?, soap, freeText?)
 *   - updateEvolucao(id, soap, freeText) — só em draft
 *   - lockEvolucao(id, signMethod) — calcula hash + transição draft → locked/signed
 *   - addAttachmentMetadata(evolucaoId, kind, storagePath, mime, size, filename, contentHash)
 *     — chamado pela API Route após scanUpload aprovar; inserir como `scan_status='clean'`
 *   - markAttachmentScanResult(attachmentId, status, reason?)
 *   - softDeleteAttachment(attachmentId, reason)
 *   - listEvolucoesByMember(memberId)
 *   - getEvolucaoDetail(evolucaoId)
 *
 * **Anexo upload real** vai pelo API Route `/api/fisio/evolucao/[id]/upload`
 * (Sprint 21b — depende MinIO bucket bootstrap + scanUpload encadeado). Nesta
 * Sprint Server Action expõe addAttachmentMetadata para o caller (test, seed)
 * gravar metadata sem subir binário real.
 */

import { db } from '@repo/db/client'
import {
  type EvolucaoAttachmentKind,
  type Soap,
  generateStoragePath,
  hashEvolucaoContent,
  validateAttachmentUpload,
  validateSoapForLock,
} from '@repo/db/evolucoes'
import { evolucaoAttachments, evolucoesSessao, members } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const SoapInputSchema = z.object({
  subjetivo: z.string().max(4000).optional().nullable(),
  objetivo: z.string().max(4000).optional().nullable(),
  avaliacao: z.string().max(4000).optional().nullable(),
  plano: z.string().max(4000).optional().nullable(),
})

const CreateEvolucaoInputSchema = z.object({
  memberId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  soap: SoapInputSchema.default({}),
  freeText: z.string().max(8000).optional().nullable(),
})

const UpdateEvolucaoInputSchema = z.object({
  evolucaoId: z.string().uuid(),
  soap: SoapInputSchema,
  freeText: z.string().max(8000).optional().nullable(),
})

const LockEvolucaoInputSchema = z.object({
  evolucaoId: z.string().uuid(),
  signMethod: z.enum(['authenticated', 'icp_brasil']).default('authenticated'),
  signatureProvider: z.string().max(80).optional().nullable(),
})

const AttachmentKindEnum = z.enum([
  'exame_imagem',
  'video_execucao',
  'documento',
  'foto_postural',
  'audio_anamnese',
])

const AddAttachmentInputSchema = z.object({
  evolucaoId: z.string().uuid(),
  kind: AttachmentKindEnum,
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  /** Hash sha256 hex calculado no upload (idempotência) */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  caption: z.string().max(500).optional().nullable(),
  /** Quando true (Sprint 21b com upload real), persiste `scan_status='pending'` e API Route
   *  finaliza via markAttachmentScanResult. Default false = persiste como 'clean'
   *  (caller já garantiu scanUpload). */
  pendingScan: z.boolean().default(false),
})

const MarkScanResultInputSchema = z.object({
  attachmentId: z.string().uuid(),
  status: z.enum(['clean', 'rejected']),
  reason: z.string().max(500).optional().nullable(),
})

const SoftDeleteAttachmentInputSchema = z.object({
  attachmentId: z.string().uuid(),
  reason: z.string().min(3).max(500),
})

// ─── createEvolucao ──────────────────────────────────────────────────────

export const createEvolucao = wrapServerAction(
  { module: 'fisio', action: 'evolucao.create', resourceType: 'evolucoes_sessao' },
  async (input: z.infer<typeof CreateEvolucaoInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateEvolucaoInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

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

    try {
      const [row] = await db
        .insert(evolucoesSessao)
        .values({
          tenantId,
          companyId: member.companyId,
          memberId: parsed.memberId,
          appointmentId: parsed.appointmentId ?? null,
          professionalUserId: session.logifit.userId,
          soap: parsed.soap as unknown as Record<string, unknown>,
          freeText: parsed.freeText ?? null,
          status: 'draft',
        })
        .returning({ id: evolucoesSessao.id })
      setAuditResource(row!.id, { memberId: parsed.memberId, appointmentId: parsed.appointmentId })
      return { id: row!.id }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Esse appointment já tem evolução vinculada',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── updateEvolucao ──────────────────────────────────────────────────────

export const updateEvolucao = wrapServerAction(
  { module: 'fisio', action: 'evolucao.update', resourceType: 'evolucoes_sessao' },
  async (input: z.infer<typeof UpdateEvolucaoInputSchema>, { session, setAuditResource }) => {
    const parsed = UpdateEvolucaoInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [c] = await db
      .select({ id: evolucoesSessao.id, status: evolucoesSessao.status })
      .from(evolucoesSessao)
      .where(and(eq(evolucoesSessao.id, parsed.evolucaoId), eq(evolucoesSessao.tenantId, tenantId)))
      .limit(1)
    if (!c)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Evolução não encontrada',
        request_id: '',
      })
    if (c.status !== 'draft')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Evolução já fechada — crie nova evolução para mudanças',
        request_id: '',
      })

    await db
      .update(evolucoesSessao)
      .set({
        soap: parsed.soap as unknown as Record<string, unknown>,
        freeText: parsed.freeText ?? null,
        updatedAt: new Date(),
      })
      .where(eq(evolucoesSessao.id, parsed.evolucaoId))
    setAuditResource(parsed.evolucaoId, {})
    return { ok: true }
  },
)

// ─── lockEvolucao ────────────────────────────────────────────────────────

export const lockEvolucao = wrapServerAction(
  { module: 'fisio', action: 'evolucao.lock', resourceType: 'evolucoes_sessao' },
  async (input: z.infer<typeof LockEvolucaoInputSchema>, { session, setAuditResource }) => {
    const parsed = LockEvolucaoInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [e] = await db
      .select({
        id: evolucoesSessao.id,
        status: evolucoesSessao.status,
        soap: evolucoesSessao.soap,
        freeText: evolucoesSessao.freeText,
        professionalUserId: evolucoesSessao.professionalUserId,
      })
      .from(evolucoesSessao)
      .where(and(eq(evolucoesSessao.id, parsed.evolucaoId), eq(evolucoesSessao.tenantId, tenantId)))
      .limit(1)
    if (!e)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Evolução não encontrada',
        request_id: '',
      })
    if (e.status !== 'draft')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Evolução já fechada',
        request_id: '',
      })
    if (e.professionalUserId !== session.user.id)
      throw new ApiException({
        code: 'FORBIDDEN',
        message: 'Apenas o profissional autor pode fechar a evolução',
        request_id: '',
      })

    // Valida SOAP tem conteúdo
    const soapValid = validateSoapForLock((e.soap as unknown as Soap) ?? {}, e.freeText)
    if (!soapValid.ok)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: soapValid.reason ?? 'SOAP inválido',
        request_id: '',
      })

    // Carrega attachments clean pra incluir no hash
    const attachments = await db
      .select({ id: evolucaoAttachments.id })
      .from(evolucaoAttachments)
      .where(
        and(
          eq(evolucaoAttachments.evolucaoId, e.id),
          eq(evolucaoAttachments.scanStatus, 'clean'),
          isNull(evolucaoAttachments.softDeletedAt),
        ),
      )

    const now = new Date()
    const contentHash = hashEvolucaoContent({
      soap: (e.soap as unknown as Soap) ?? {},
      freeText: e.freeText,
      attachmentIds: attachments.map((a) => a.id),
      professionalUserId: session.logifit.userId,
      signedAtIso: now.toISOString(),
    })

    const isIcp = parsed.signMethod === 'icp_brasil'
    const newStatus = isIcp ? 'signed' : 'locked'

    await db
      .update(evolucoesSessao)
      .set({
        status: newStatus,
        lockedAt: now,
        lockedByUserId: session.logifit.userId,
        signedAt: isIcp ? now : null,
        signedHash: contentHash,
        signatureProvider: parsed.signatureProvider ?? null,
        updatedAt: now,
      })
      .where(eq(evolucoesSessao.id, e.id))

    setAuditResource(e.id, { newStatus, contentHash })
    return { ok: true, status: newStatus, signedHash: contentHash }
  },
)

// ─── addAttachmentMetadata ───────────────────────────────────────────────

export const addAttachmentMetadata = wrapServerAction(
  {
    module: 'fisio',
    action: 'evolucao.attachment_add',
    resourceType: 'evolucao_attachments',
  },
  async (input: z.infer<typeof AddAttachmentInputSchema>, { session, setAuditResource }) => {
    const parsed = AddAttachmentInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Validação dupla — schema já restringe, mas defesa em profundidade
    const validation = validateAttachmentUpload({
      kind: parsed.kind as EvolucaoAttachmentKind,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      filename: parsed.filename,
    })
    if (!validation.ok)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: validation.reason ?? 'Anexo inválido',
        request_id: '',
      })

    const [e] = await db
      .select({ id: evolucoesSessao.id, status: evolucoesSessao.status })
      .from(evolucoesSessao)
      .where(and(eq(evolucoesSessao.id, parsed.evolucaoId), eq(evolucoesSessao.tenantId, tenantId)))
      .limit(1)
    if (!e)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Evolução não encontrada',
        request_id: '',
      })
    if (e.status !== 'draft')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Anexos só podem ser adicionados em rascunho',
        request_id: '',
      })

    const storagePath = generateStoragePath({
      tenantId,
      evolucaoId: parsed.evolucaoId,
      filename: parsed.filename,
      contentHash: parsed.contentHash,
    })

    const [row] = await db
      .insert(evolucaoAttachments)
      .values({
        tenantId,
        evolucaoId: parsed.evolucaoId,
        kind: parsed.kind,
        storagePath,
        storageBucket: 'fisio-evolucoes',
        filename: parsed.filename,
        sizeBytes: parsed.sizeBytes,
        mimeType: parsed.mimeType,
        contentHash: parsed.contentHash,
        scanStatus: parsed.pendingScan ? 'pending' : 'clean',
        caption: parsed.caption ?? null,
        uploadedByUserId: session.logifit.userId,
      })
      .returning({ id: evolucaoAttachments.id })

    setAuditResource(row!.id, {
      evolucaoId: parsed.evolucaoId,
      kind: parsed.kind,
      sizeBytes: parsed.sizeBytes,
    })
    return { id: row!.id, storagePath }
  },
)

// ─── markAttachmentScanResult ────────────────────────────────────────────

export const markAttachmentScanResult = wrapServerAction(
  {
    module: 'fisio',
    action: 'evolucao.attachment_scan_result',
    resourceType: 'evolucao_attachments',
  },
  async (input: z.infer<typeof MarkScanResultInputSchema>, { session, setAuditResource }) => {
    const parsed = MarkScanResultInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .update(evolucaoAttachments)
      .set({ scanStatus: parsed.status, scanReason: parsed.reason ?? null })
      .where(
        and(
          eq(evolucaoAttachments.id, parsed.attachmentId),
          eq(evolucaoAttachments.tenantId, tenantId),
        ),
      )
      .returning({ id: evolucaoAttachments.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Anexo não encontrado',
        request_id: '',
      })
    setAuditResource(row.id, { status: parsed.status })
    return { ok: true }
  },
)

// ─── softDeleteAttachment ────────────────────────────────────────────────

export const softDeleteAttachment = wrapServerAction(
  {
    module: 'fisio',
    action: 'evolucao.attachment_delete',
    resourceType: 'evolucao_attachments',
  },
  async (input: z.infer<typeof SoftDeleteAttachmentInputSchema>, { session, setAuditResource }) => {
    const parsed = SoftDeleteAttachmentInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .update(evolucaoAttachments)
      .set({
        scanStatus: 'soft_deleted',
        softDeletedAt: new Date(),
        softDeletedByUserId: session.logifit.userId,
        softDeleteReason: parsed.reason,
      })
      .where(
        and(
          eq(evolucaoAttachments.id, parsed.attachmentId),
          eq(evolucaoAttachments.tenantId, tenantId),
          isNull(evolucaoAttachments.softDeletedAt),
        ),
      )
      .returning({ id: evolucaoAttachments.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Anexo não encontrado ou já deletado',
        request_id: '',
      })
    setAuditResource(row.id, { reason: parsed.reason })
    return { ok: true }
  },
)

// ─── listEvolucoesByMember ───────────────────────────────────────────────

export const listEvolucoesByMember = wrapServerAction(
  { module: 'fisio', action: 'evolucao.list_by_member' },
  async (input: { memberId: string; limit?: number }, { session }) => {
    const parsed = z
      .object({ memberId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(100) })
      .parse(input)
    const tenantId = session.logifit.tenantId

    const rows = await db
      .select({
        id: evolucoesSessao.id,
        appointmentId: evolucoesSessao.appointmentId,
        status: evolucoesSessao.status,
        lockedAt: evolucoesSessao.lockedAt,
        signedAt: evolucoesSessao.signedAt,
        professionalUserId: evolucoesSessao.professionalUserId,
        createdAt: evolucoesSessao.createdAt,
        attachmentsCount: sql<number>`(SELECT COUNT(*)::int FROM evolucao_attachments WHERE evolucao_id = ${evolucoesSessao.id} AND soft_deleted_at IS NULL)`,
      })
      .from(evolucoesSessao)
      .where(
        and(
          eq(evolucoesSessao.tenantId, tenantId),
          eq(evolucoesSessao.memberId, parsed.memberId),
          isNull(evolucoesSessao.archivedAt),
        ),
      )
      .orderBy(desc(evolucoesSessao.createdAt))
      .limit(parsed.limit)
    return { evolucoes: rows }
  },
)

// ─── getEvolucaoAttachments ──────────────────────────────────────────────

export const listEvolucaoAttachments = wrapServerAction(
  { module: 'fisio', action: 'evolucao.list_attachments' },
  async (input: { evolucaoId: string }, { session }) => {
    const parsed = z.object({ evolucaoId: z.string().uuid() }).parse(input)
    const tenantId = session.logifit.tenantId

    const rows = await db
      .select({
        id: evolucaoAttachments.id,
        kind: evolucaoAttachments.kind,
        filename: evolucaoAttachments.filename,
        mimeType: evolucaoAttachments.mimeType,
        sizeBytes: evolucaoAttachments.sizeBytes,
        scanStatus: evolucaoAttachments.scanStatus,
        scanReason: evolucaoAttachments.scanReason,
        caption: evolucaoAttachments.caption,
        contentHash: evolucaoAttachments.contentHash,
        uploadedAt: evolucaoAttachments.uploadedAt,
        softDeletedAt: evolucaoAttachments.softDeletedAt,
      })
      .from(evolucaoAttachments)
      .where(
        and(
          eq(evolucaoAttachments.evolucaoId, parsed.evolucaoId),
          eq(evolucaoAttachments.tenantId, tenantId),
        ),
      )
      .orderBy(asc(evolucaoAttachments.uploadedAt))
    return { attachments: rows }
  },
)

// ─── getAttachmentSignedUrl (placeholder Sprint 21b) ────────────────────

export const getAttachmentSignedUrl = wrapServerAction(
  { module: 'fisio', action: 'evolucao.attachment_signed_url' },
  async (_input: { attachmentId: string; ttlSeconds?: number }, { session: _session }) => {
    throw new ApiException({
      code: 'INTERNAL_ERROR',
      message:
        'URL assinada chega no Sprint 21b com adapter MinIO + bootstrap dos buckets. UI lista metadata por enquanto.',
      request_id: '',
    })
  },
)
