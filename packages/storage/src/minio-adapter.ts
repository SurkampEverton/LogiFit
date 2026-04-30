/**
 * MinioStorageAdapter — implementação do `StorageAdapter` via protocolo S3.
 *
 * MinIO fala S3 nativamente; usamos `@aws-sdk/client-s3` apontando pro endpoint
 * do MinIO (dev: container Docker; prod: container Coolify, ADR 0091). Trocar
 * pra outro provedor S3-compatible (R2, Wasabi, Backblaze B2) é só mudar a
 * config — código consumidor não muda (regra de soberania perpétua #3).
 *
 * Decisões deliberadas:
 *  - `forcePathStyle: true` — MinIO não suporta virtual-host style.
 *  - `validate*` corre Zod no boundary (regra 7) antes do SDK.
 *  - Erros AWS traduzidos para `StorageError` discriminado (consumidor não
 *    enxerga `NoSuchKey`/`NoSuchBucket` raw).
 *  - `presign*` usa `s3-request-presigner` — TTL clamped pelo Zod (max 7d).
 *  - `head` retorna `null` em 404 (idiomático JS), erro real só pra outros.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { type BucketName, physicalBucketName } from './buckets'
import {
  type DeleteInput,
  DeleteInputSchema,
  type GetInput,
  GetInputSchema,
  type GetResult,
  type HeadInput,
  HeadInputSchema,
  type HeadResult,
  type ListInput,
  ListInputSchema,
  type ListItem,
  type PresignGetInput,
  PresignGetInputSchema,
  type PresignPutInput,
  PresignPutInputSchema,
  type PutInput,
  PutInputSchema,
  type PutResult,
  type StorageAdapter,
  StorageError,
} from './types'

export interface MinioAdapterConfig {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucketPrefix: string
  /** `true` em dev (HTTP) e MinIO em geral. */
  forcePathStyle?: boolean
}

interface AwsLikeError {
  name?: string
  $metadata?: { httpStatusCode?: number }
  Code?: string
  message?: string
}

function asAwsError(err: unknown): AwsLikeError {
  return (typeof err === 'object' && err !== null ? err : {}) as AwsLikeError
}

function translateError(err: unknown, fallback: string): StorageError {
  const e = asAwsError(err)
  const status = e.$metadata?.httpStatusCode
  const name = e.name ?? e.Code ?? ''

  // Ordem importa: bucket-not-found vem ANTES de qualquer 404 genérico,
  // se não, `head()` engoliria erro de config (bucket inexistente) como
  // se o objeto fosse o problema.
  if (name === 'NoSuchBucket') {
    return new StorageError('BUCKET_NOT_FOUND', `bucket não encontrado: ${fallback}`, err)
  }
  if (status === 403 || name === 'AccessDenied') {
    return new StorageError('PERMISSION_DENIED', `acesso negado: ${fallback}`, err)
  }
  if (name === 'NoSuchKey' || status === 404) {
    return new StorageError('NOT_FOUND', `objeto não encontrado: ${fallback}`, err)
  }
  return new StorageError(
    'INTERNAL',
    `${fallback}: ${e.message ?? name ?? 'erro desconhecido'}`,
    err,
  )
}

function bucketOf(prefix: string, name: BucketName): string {
  return physicalBucketName(prefix, name)
}

export class MinioStorageAdapter implements StorageAdapter {
  readonly client: S3Client
  readonly config: MinioAdapterConfig

  constructor(config: MinioAdapterConfig) {
    this.config = config
    const clientConfig: S3ClientConfig = {
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }
    this.client = new S3Client(clientConfig)
  }

  /** Acesso interno pro bootstrap criar buckets sem reabrir cliente. */
  resolveBucket(name: BucketName): string {
    return bucketOf(this.config.bucketPrefix, name)
  }

  async put(input: PutInput): Promise<PutResult> {
    const parsed = PutInputSchema.parse(input)
    const Bucket = bucketOf(this.config.bucketPrefix, parsed.bucket)
    try {
      const out = await this.client.send(
        new PutObjectCommand({
          Bucket,
          Key: parsed.key,
          Body:
            typeof parsed.body === 'string' ? new TextEncoder().encode(parsed.body) : parsed.body,
          ContentType: parsed.contentType,
          Metadata: parsed.metadata,
        }),
      )
      const etag = (out.ETag ?? '').replace(/"/g, '')
      return { etag, key: parsed.key }
    } catch (err) {
      throw translateError(err, `${Bucket}/${parsed.key}`)
    }
  }

  async get(input: GetInput): Promise<GetResult> {
    const parsed = GetInputSchema.parse(input)
    const Bucket = bucketOf(this.config.bucketPrefix, parsed.bucket)
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket, Key: parsed.key }))
      if (!out.Body) {
        throw new StorageError('INTERNAL', `objeto sem corpo: ${Bucket}/${parsed.key}`)
      }
      // out.Body em Node 22 é um Readable; transformToWebStream existe no SDK v3
      const body = (
        out.Body as { transformToWebStream: () => ReadableStream<Uint8Array> }
      ).transformToWebStream()
      return {
        body,
        contentType: out.ContentType ?? 'application/octet-stream',
        etag: (out.ETag ?? '').replace(/"/g, ''),
        size: typeof out.ContentLength === 'number' ? out.ContentLength : 0,
      }
    } catch (err) {
      if (err instanceof StorageError) throw err
      throw translateError(err, `${Bucket}/${parsed.key}`)
    }
  }

  async head(input: HeadInput): Promise<HeadResult | null> {
    const parsed = HeadInputSchema.parse(input)
    const Bucket = bucketOf(this.config.bucketPrefix, parsed.bucket)
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket, Key: parsed.key }))
      return {
        size: typeof out.ContentLength === 'number' ? out.ContentLength : 0,
        contentType: out.ContentType ?? 'application/octet-stream',
        etag: (out.ETag ?? '').replace(/"/g, ''),
        metadata: out.Metadata ?? {},
        modified: out.LastModified ?? new Date(0),
      }
    } catch (err) {
      const translated = translateError(err, `${Bucket}/${parsed.key}`)
      if (translated.code === 'NOT_FOUND') return null
      throw translated
    }
  }

  async delete(input: DeleteInput): Promise<void> {
    const parsed = DeleteInputSchema.parse(input)
    const Bucket = bucketOf(this.config.bucketPrefix, parsed.bucket)
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket, Key: parsed.key }))
    } catch (err) {
      throw translateError(err, `${Bucket}/${parsed.key}`)
    }
  }

  async list(input: ListInput): Promise<ListItem[]> {
    const parsed = ListInputSchema.parse(input)
    const Bucket = bucketOf(this.config.bucketPrefix, parsed.bucket)
    try {
      const out: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: parsed.prefix,
          MaxKeys: parsed.limit,
        }),
      )
      const contents = out.Contents ?? []
      return contents.map((o) => ({
        key: o.Key ?? '',
        size: typeof o.Size === 'number' ? o.Size : 0,
        etag: (o.ETag ?? '').replace(/"/g, ''),
        modified: o.LastModified ?? new Date(0),
      }))
    } catch (err) {
      throw translateError(err, Bucket)
    }
  }

  async presignGet(input: PresignGetInput): Promise<string> {
    const parsed = PresignGetInputSchema.parse(input)
    const Bucket = bucketOf(this.config.bucketPrefix, parsed.bucket)
    try {
      return await getSignedUrl(this.client, new GetObjectCommand({ Bucket, Key: parsed.key }), {
        expiresIn: parsed.ttlSeconds,
      })
    } catch (err) {
      throw translateError(err, `${Bucket}/${parsed.key}`)
    }
  }

  async presignPut(input: PresignPutInput): Promise<string> {
    const parsed = PresignPutInputSchema.parse(input)
    const Bucket = bucketOf(this.config.bucketPrefix, parsed.bucket)
    try {
      return await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket,
          Key: parsed.key,
          ContentType: parsed.contentType,
        }),
        { expiresIn: parsed.ttlSeconds },
      )
    } catch (err) {
      throw translateError(err, `${Bucket}/${parsed.key}`)
    }
  }
}
