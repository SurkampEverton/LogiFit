/**
 * Contratos do storage adapter (regra de soberania perpétua #3 — ADR 0091).
 *
 * Toda feature de negócio que precise gravar/ler binário consome SOMENTE estas
 * interfaces. Importar `@aws-sdk/*` direto fora deste package é proibido (lint
 * `no-direct-aws-sdk` previsto Faixa 4 do Sprint 00).
 *
 * Inputs validados com Zod no boundary de cada método (regra 7) — adapter
 * concreto não confia no chamador.
 */

import { z } from 'zod'
import type { BucketName } from './buckets'
import { BUCKET_NAMES } from './buckets'

/** Códigos canônicos de erro de storage; mapeáveis pra envelope ADR 0071. */
export type StorageErrorCode =
  | 'NOT_FOUND'
  | 'BUCKET_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'INTERNAL'

export class StorageError extends Error {
  readonly code: StorageErrorCode

  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined)
    this.name = 'StorageError'
    this.code = code
  }
}

const bucketSchema = z.enum(BUCKET_NAMES as unknown as [BucketName, ...BucketName[]])

/**
 * Chave de objeto: 1-1024 chars, sem path traversal, sem espaços nas pontas,
 * sem null byte. Sanitização adicional fica em `tenant-key.ts` quando a chave
 * é gerada pelo sistema; aqui só barramos lixo óbvio.
 */
const objectKeySchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((v) => !v.includes('\0'), { message: 'key contains null byte' })
  .refine((v) => !v.startsWith('/') && !v.endsWith('/'), {
    message: 'key cannot start or end with /',
  })
  .refine((v) => !v.split('/').some((seg) => seg === '..' || seg === '.'), {
    message: 'key contains . or .. segment (path traversal)',
  })

const ttlSchema = z
  .number()
  .int()
  .positive()
  .max(7 * 24 * 3600) // máx 7 dias

export const PutInputSchema = z.object({
  bucket: bucketSchema,
  key: objectKeySchema,
  body: z.union([z.instanceof(Uint8Array), z.instanceof(Buffer), z.string()]),
  contentType: z.string().min(1).max(255),
  /** Metadados livres salvos como `x-amz-meta-*`. Valores ASCII. */
  metadata: z.record(z.string(), z.string().regex(/^[\x20-\x7e]*$/)).optional(),
})
export type PutInput = z.infer<typeof PutInputSchema>

export const GetInputSchema = z.object({
  bucket: bucketSchema,
  key: objectKeySchema,
})
export type GetInput = z.infer<typeof GetInputSchema>

export const HeadInputSchema = GetInputSchema
export type HeadInput = z.infer<typeof HeadInputSchema>

export const DeleteInputSchema = GetInputSchema
export type DeleteInput = z.infer<typeof DeleteInputSchema>

export const ListInputSchema = z.object({
  bucket: bucketSchema,
  prefix: z.string().max(1024).optional(),
  limit: z.number().int().positive().max(1000).optional(),
})
export type ListInput = z.infer<typeof ListInputSchema>

export const PresignGetInputSchema = z.object({
  bucket: bucketSchema,
  key: objectKeySchema,
  ttlSeconds: ttlSchema,
})
export type PresignGetInput = z.infer<typeof PresignGetInputSchema>

export const PresignPutInputSchema = z.object({
  bucket: bucketSchema,
  key: objectKeySchema,
  ttlSeconds: ttlSchema,
  contentType: z.string().min(1).max(255),
})
export type PresignPutInput = z.infer<typeof PresignPutInputSchema>

export interface PutResult {
  /** ETag fornecido pelo backend (S3/MinIO) sem aspas. */
  etag: string
  /** Mesma `key` ecoada — útil pra encadeamento sem reler input. */
  key: string
}

export interface GetResult {
  body: ReadableStream<Uint8Array>
  contentType: string
  etag: string
  size: number
}

export interface HeadResult {
  size: number
  contentType: string
  etag: string
  metadata: Record<string, string>
  modified: Date
}

export interface ListItem {
  key: string
  size: number
  etag: string
  modified: Date
}

/**
 * Contrato único consumido pelas features. `MinioStorageAdapter` é o único
 * impl no MVP (ADR 0091); R2 ou outro impl futuro reutiliza este shape.
 */
export interface StorageAdapter {
  put(input: PutInput): Promise<PutResult>
  get(input: GetInput): Promise<GetResult>
  head(input: HeadInput): Promise<HeadResult | null>
  delete(input: DeleteInput): Promise<void>
  list(input: ListInput): Promise<ListItem[]>
  presignGet(input: PresignGetInput): Promise<string>
  presignPut(input: PresignPutInput): Promise<string>
}
