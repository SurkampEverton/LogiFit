/**
 * Bootstrap idempotente dos 6 buckets canônicos no MinIO.
 *
 * Uso:
 *   pnpm storage:bootstrap                  # raiz
 *   pnpm --filter @repo/storage bootstrap   # equivalente
 *
 * Lê env via `createStorageAdapter` (factory.ts) — mesmas variáveis que a app
 * em runtime. Idempotente: re-rodar é seguro (BucketAlreadyOwnedByYou tratado
 * como sucesso).
 *
 * Em prod (Coolify), rodar como step pós-deploy do container Next.js OU como
 * job único na primeira ativação do MinIO. Plano fica documentado em
 * `docs/runbooks/bootstrap-oracle.md` (Sprint 00 Faixa 2).
 */

import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { BUCKET_NAMES, type BucketName } from '../src/buckets'
import { createStorageAdapter } from '../src/factory'

interface BucketResult {
  bucket: BucketName
  physical: string
  status: 'created' | 'already-exists' | 'error'
  error?: string
}

async function bucketExists(client: S3Client, name: string): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: name }))
    return true
  } catch (err) {
    const e = err as { $metadata?: { httpStatusCode?: number }; name?: string }
    if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return false
    if (e.name === 'NoSuchBucket') return false
    throw err
  }
}

async function ensureBucket(
  client: S3Client,
  bucket: BucketName,
  physical: string,
): Promise<BucketResult> {
  try {
    if (await bucketExists(client, physical)) {
      // Versionamento pode ter sido pulado em criação anterior — reaplica.
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: physical,
          VersioningConfiguration: { Status: 'Enabled' },
        }),
      )
      return { bucket, physical, status: 'already-exists' }
    }
    await client.send(new CreateBucketCommand({ Bucket: physical }))
    await client.send(
      new PutBucketVersioningCommand({
        Bucket: physical,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    )
    return { bucket, physical, status: 'created' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { bucket, physical, status: 'error', error: message }
  }
}

async function main(): Promise<void> {
  const adapter = createStorageAdapter()
  const client = adapter.client

  // eslint-disable-next-line no-console
  console.log(`[storage:bootstrap] endpoint=${adapter.config.endpoint}`)
  // eslint-disable-next-line no-console
  console.log(`[storage:bootstrap] prefix=${adapter.config.bucketPrefix}`)

  const results: BucketResult[] = []
  for (const bucket of BUCKET_NAMES) {
    const physical = adapter.resolveBucket(bucket)
    const result = await ensureBucket(client, bucket, physical)
    results.push(result)
    const tag =
      result.status === 'created' ? '[+]' : result.status === 'already-exists' ? '[=]' : '[!]'
    // eslint-disable-next-line no-console
    console.log(`${tag} ${physical} (${result.status})${result.error ? ` — ${result.error}` : ''}`)
  }

  const errors = results.filter((r) => r.status === 'error')
  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n[storage:bootstrap] ${errors.length} erro(s) — abortando.`)
    process.exit(1)
  }

  // eslint-disable-next-line no-console
  console.log(`\n[storage:bootstrap] ok — ${results.length} bucket(s) garantido(s).`)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[storage:bootstrap] fatal:', err)
  process.exit(1)
})
