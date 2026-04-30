/**
 * Composição de chaves de objeto S3/MinIO escopadas por tenant.
 *
 * Formato: `${tenantId}/${ownerKind}/${ownerId}/${YYYY}/${MM}/${uuid}.${ext}`
 *
 * Por que prefixo por tenant:
 *  - Listagem barata via `prefix=${tenantId}/` (sem cross-tenant accidental).
 *  - Backup/restore por tenant (regra 40) trabalha em sub-árvore.
 *  - Bucket policy futura pode amarrar role ao prefixo (defesa em camada extra).
 *
 * Sanitização rejeita: path traversal, separadores, caracteres não-ASCII,
 * extensões fora da allowlist. UUID gerado via `crypto.randomUUID()` (Node 22).
 *
 * Não substitui `scanUpload` (regra 38) — só compõe o caminho onde o arquivo
 * vai parar depois do scan retornar `clean`.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { StorageError } from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Allowlist conservadora — domínios que precisarem mais entram aqui explicitamente. */
export const ALLOWED_EXTENSIONS = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'mp3',
  'mp4',
  'ogg',
  'webm',
  'csv',
  'txt',
] as const
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number]

const ownerKindSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_-]*$/, 'ownerKind: lowercase ascii com - _ apenas')

export interface TenantKeyInput {
  tenantId: string
  ownerKind: string
  ownerId: string
  ext: AllowedExtension
  /** Override só para teste (clock injection). Default `new Date()`. */
  now?: Date
}

export interface TenantKeyResult {
  key: string
  uuid: string
}

export function tenantKey(input: TenantKeyInput): TenantKeyResult {
  if (!UUID_RE.test(input.tenantId)) {
    throw new StorageError('INVALID_INPUT', `tenantId não é UUID: ${input.tenantId}`)
  }
  if (!UUID_RE.test(input.ownerId)) {
    throw new StorageError('INVALID_INPUT', `ownerId não é UUID: ${input.ownerId}`)
  }
  const ownerKindParsed = ownerKindSchema.safeParse(input.ownerKind)
  if (!ownerKindParsed.success) {
    throw new StorageError(
      'INVALID_INPUT',
      `ownerKind inválido: ${ownerKindParsed.error.issues[0]?.message ?? 'unknown'}`,
    )
  }
  if (!ALLOWED_EXTENSIONS.includes(input.ext)) {
    throw new StorageError('INVALID_INPUT', `extensão não permitida: ${input.ext}`)
  }

  const now = input.now ?? new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const uuid = randomUUID()

  const key = `${input.tenantId}/${ownerKindParsed.data}/${input.ownerId}/${yyyy}/${mm}/${uuid}.${input.ext}`
  return { key, uuid }
}

/**
 * Verifica se uma chave pertence ao tenant declarado. Útil em auditoria e em
 * ações que recebem a chave do cliente (impede passar chave de outro tenant).
 */
export function keyBelongsToTenant(key: string, tenantId: string): boolean {
  return key.startsWith(`${tenantId}/`)
}
