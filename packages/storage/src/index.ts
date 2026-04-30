/**
 * Public API do `@repo/storage`.
 *
 * Consumidores importam SOMENTE daqui — nunca de submódulos. Isso preserva o
 * adapter pattern (ADR 0091, soberania perpétua #3): se um dia trocarmos
 * MinIO por outro impl S3-compatible, tudo o que muda é a `factory`.
 */

export { BUCKETS, BUCKET_NAMES, physicalBucketName } from './buckets'
export type { BucketName } from './buckets'

export {
  StorageError,
  PutInputSchema,
  GetInputSchema,
  HeadInputSchema,
  DeleteInputSchema,
  ListInputSchema,
  PresignGetInputSchema,
  PresignPutInputSchema,
} from './types'
export type {
  StorageAdapter,
  StorageErrorCode,
  PutInput,
  GetInput,
  HeadInput,
  DeleteInput,
  ListInput,
  PresignGetInput,
  PresignPutInput,
  PutResult,
  GetResult,
  HeadResult,
  ListItem,
} from './types'

export {
  ALLOWED_EXTENSIONS,
  tenantKey,
  keyBelongsToTenant,
} from './tenant-key'
export type { AllowedExtension, TenantKeyInput, TenantKeyResult } from './tenant-key'

export { MinioStorageAdapter } from './minio-adapter'
export type { MinioAdapterConfig } from './minio-adapter'

export { createStorageAdapter, readStorageEnv } from './factory'
export type { StorageEnv } from './factory'
