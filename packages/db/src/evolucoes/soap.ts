/**
 * SOAP schema + validator de anexos — Sprint 21 Faixa B.1.
 *
 * Funções puras (sem DB). Server Action consome.
 *
 * **SOAP enxuto** (vs prontuário `consultas` Sprint 20):
 *   - 4 campos opcionais; pelo menos 1 deve ter conteúdo pra lock/sign
 *   - Limite 4000 chars cada (sessão de tratamento é descrição curta)
 *
 * **Validador anexo:**
 *   - MIME por categoria (`kind`):
 *     - exame_imagem: jpg/png/dicom
 *     - video_execucao: mp4/webm/mov (max 50MB)
 *     - documento: pdf
 *     - foto_postural: jpg/png
 *     - audio_anamnese: mp3/m4a/webm (audio)
 *   - 50MB max enforced no schema CHECK + lib double-check
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'

// ─── SOAP ────────────────────────────────────────────────────────────────

export const SoapSchema = z.object({
  subjetivo: z.string().max(4000).optional().nullable(),
  objetivo: z.string().max(4000).optional().nullable(),
  avaliacao: z.string().max(4000).optional().nullable(),
  plano: z.string().max(4000).optional().nullable(),
})

export type Soap = z.infer<typeof SoapSchema>

export interface ValidationResult {
  ok: boolean
  reason?: string
}

/**
 * Pelo menos 1 campo SOAP ou free_text deve ter conteúdo significativo
 * (>10 chars trimmed) para considerar a evolução elegível pra lock/sign.
 */
export function validateSoapForLock(soap: Soap, freeText?: string | null): ValidationResult {
  const fields = [soap.subjetivo, soap.objetivo, soap.avaliacao, soap.plano, freeText]
  const hasContent = fields.some((f) => f != null && f.trim().length >= 10)
  if (!hasContent) {
    return {
      ok: false,
      reason: 'Pelo menos um campo SOAP ou texto livre deve ter conteúdo significativo (≥10 chars)',
    }
  }
  return { ok: true }
}

// ─── Anexos ──────────────────────────────────────────────────────────────

export type EvolucaoAttachmentKind =
  | 'exame_imagem'
  | 'video_execucao'
  | 'documento'
  | 'foto_postural'
  | 'audio_anamnese'

/** MIME types aceitos por categoria. Server Action valida antes do scanUpload. */
export const ALLOWED_MIMES_BY_KIND: Record<EvolucaoAttachmentKind, ReadonlyArray<string>> = {
  exame_imagem: ['image/jpeg', 'image/png', 'application/dicom'],
  video_execucao: ['video/mp4', 'video/webm', 'video/quicktime'],
  documento: ['application/pdf'],
  foto_postural: ['image/jpeg', 'image/png'],
  audio_anamnese: ['audio/mpeg', 'audio/mp4', 'audio/webm'],
}

export const MAX_SIZE_BY_KIND: Record<EvolucaoAttachmentKind, number> = {
  exame_imagem: 20 * 1024 * 1024, // 20MB (DICOM grande já chega aqui)
  video_execucao: 50 * 1024 * 1024, // 50MB (limite global)
  documento: 10 * 1024 * 1024, // 10MB (PDF de laudo)
  foto_postural: 8 * 1024 * 1024, // 8MB
  audio_anamnese: 30 * 1024 * 1024, // 30MB (~30min em mp3)
}

export const MAX_SIZE_GLOBAL = 50 * 1024 * 1024 // 50MB hard limit (schema CHECK também)

export interface AttachmentUploadInput {
  kind: EvolucaoAttachmentKind
  mimeType: string
  sizeBytes: number
  filename: string
}

export function validateAttachmentUpload(input: AttachmentUploadInput): ValidationResult {
  // 1. MIME por kind
  const allowed = ALLOWED_MIMES_BY_KIND[input.kind]
  if (!allowed.includes(input.mimeType)) {
    return {
      ok: false,
      reason: `MIME ${input.mimeType} não permitido para ${input.kind}. Aceitos: ${allowed.join(', ')}`,
    }
  }

  // 2. Tamanho por kind
  const maxKind = MAX_SIZE_BY_KIND[input.kind]
  if (input.sizeBytes > maxKind) {
    return {
      ok: false,
      reason: `Arquivo excede limite de ${(maxKind / 1024 / 1024).toFixed(0)}MB para ${input.kind}`,
    }
  }

  // 3. Tamanho global
  if (input.sizeBytes > MAX_SIZE_GLOBAL) {
    return {
      ok: false,
      reason: `Arquivo excede limite global de ${(MAX_SIZE_GLOBAL / 1024 / 1024).toFixed(0)}MB`,
    }
  }

  // 4. Tamanho mínimo
  if (input.sizeBytes <= 0) {
    return { ok: false, reason: 'Arquivo vazio' }
  }

  // 5. Filename sanitizado
  if (!/^[\w.\- ()]{1,255}$/.test(input.filename)) {
    return {
      ok: false,
      reason:
        'Filename inválido (use apenas letras, números, espaço, ponto, parênteses, hífen, underline)',
    }
  }

  return { ok: true }
}

// ─── Hash do conteúdo da evolução (regra 39) ────────────────────────────

export interface EvolucaoHashInput {
  soap: Soap
  freeText: string | null
  attachmentIds: string[]
  professionalUserId: string
  signedAtIso: string
}

export function hashEvolucaoContent(input: EvolucaoHashInput): string {
  const ordered = {
    soap: orderKeys((input.soap as unknown as Record<string, unknown>) ?? {}),
    freeText: input.freeText ?? '',
    attachmentIds: input.attachmentIds.slice().sort(),
    professionalUserId: input.professionalUserId,
    signedAtIso: input.signedAtIso,
  }
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}

function orderKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) out[key] = obj[key]
  return out
}

// ─── Storage path generator (caller passa pra tenantKey) ────────────────

export function generateStoragePath(input: {
  tenantId: string
  evolucaoId: string
  filename: string
  contentHash: string
}): string {
  // tenants/{tenant}/evolucoes/{evolucao}/{hash}-{filename}
  // hash prefix evita colisão e identifica conteúdo na auditoria
  const safeName = input.filename.replace(/[^\w.\-]/g, '_')
  const prefix = input.contentHash.slice(0, 12)
  return `tenants/${input.tenantId}/evolucoes/${input.evolucaoId}/${prefix}-${safeName}`
}
