/**
 * Factory de StorageAdapter via env vars (regra 7 — boundary validado).
 *
 * Em dev: lê do `.env.local` (vê `.env.example` para nomes); em prod: env do
 * container Coolify. A factory é o único lugar autorizado a tocar `process.env`
 * pra storage — features importam o resultado desta função, nunca env direto.
 *
 * Variáveis canônicas (Sprint 00):
 *   MINIO_ENDPOINT          ex: http://localhost:9000  (prod: https://storage.logifit.com.br)
 *   MINIO_ACCESS_KEY        ex: minioadmin             (prod: secret rotacionado)
 *   MINIO_SECRET_KEY        ex: minioadmin             (prod: secret rotacionado)
 *   MINIO_REGION            ex: sa-east-1              (cosmético no MinIO)
 *   MINIO_BUCKET_PREFIX     ex: logifit-dev            (prod: logifit-prod)
 */

import { z } from 'zod'
import { type MinioAdapterConfig, MinioStorageAdapter } from './minio-adapter'
import { StorageError } from './types'

const StorageEnvSchema = z.object({
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_REGION: z.string().min(1).default('sa-east-1'),
  MINIO_BUCKET_PREFIX: z.string().min(1).default('logifit-dev'),
})
export type StorageEnv = z.infer<typeof StorageEnvSchema>

export function readStorageEnv(env: NodeJS.ProcessEnv = process.env): StorageEnv {
  const parsed = StorageEnvSchema.safeParse({
    MINIO_ENDPOINT: env.MINIO_ENDPOINT,
    MINIO_ACCESS_KEY: env.MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY: env.MINIO_SECRET_KEY,
    MINIO_REGION: env.MINIO_REGION,
    MINIO_BUCKET_PREFIX: env.MINIO_BUCKET_PREFIX,
  })
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ')
    throw new StorageError('INVALID_INPUT', `MINIO_* env vars inválidas/faltando — ${details}`)
  }
  return parsed.data
}

export function createStorageAdapter(env: NodeJS.ProcessEnv = process.env): MinioStorageAdapter {
  const cfg = readStorageEnv(env)
  const adapterConfig: MinioAdapterConfig = {
    endpoint: cfg.MINIO_ENDPOINT,
    region: cfg.MINIO_REGION,
    accessKeyId: cfg.MINIO_ACCESS_KEY,
    secretAccessKey: cfg.MINIO_SECRET_KEY,
    bucketPrefix: cfg.MINIO_BUCKET_PREFIX,
    forcePathStyle: true,
  }
  return new MinioStorageAdapter(adapterConfig)
}
