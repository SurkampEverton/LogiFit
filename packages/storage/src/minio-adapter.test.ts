/**
 * Testes de integração do `MinioStorageAdapter` contra MinIO local.
 *
 * Pré-requisito: `pnpm dev:up` (ou `docker compose up -d minio`). Se MinIO
 * não estiver acessível em `MINIO_ENDPOINT` (default localhost:9000), os
 * testes pulam com `it.skip` para não quebrar CI sem infra.
 *
 * Cada execução usa um prefixo único (`logifit-test-${uuid}`) para isolar de
 * outras execuções (paralelas ou anteriores que quebraram). Cleanup tenta
 * apagar tudo ao final; bucket "lixo" não machuca em dev local.
 */

import { randomUUID } from 'node:crypto'
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUCKETS } from './buckets'
import { MinioStorageAdapter } from './minio-adapter'
import { StorageError } from './types'

const TEST_PREFIX = `logifit-test-${randomUUID().slice(0, 8)}`

const config = {
  endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.MINIO_REGION ?? 'sa-east-1',
  accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
  secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
  bucketPrefix: TEST_PREFIX,
  forcePathStyle: true,
}

const adapter = new MinioStorageAdapter(config)

let minioReachable = false

async function readStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

beforeAll(async () => {
  try {
    // Tenta criar o bucket de teste — se falhar é porque MinIO não está de pé.
    const physical = adapter.resolveBucket(BUCKETS.LAB_DOCUMENTS)
    await adapter.client.send(new CreateBucketCommand({ Bucket: physical }))
    minioReachable = true
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[storage test] MinIO não acessível em ${config.endpoint} — skipping integration suite. Erro: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    minioReachable = false
  }
})

afterAll(async () => {
  if (!minioReachable) return
  const physical = adapter.resolveBucket(BUCKETS.LAB_DOCUMENTS)
  try {
    const list = await adapter.client.send(new ListObjectsV2Command({ Bucket: physical }))
    for (const obj of list.Contents ?? []) {
      if (obj.Key) {
        await adapter.client.send(new DeleteObjectCommand({ Bucket: physical, Key: obj.Key }))
      }
    }
    await adapter.client.send(new DeleteBucketCommand({ Bucket: physical }))
  } catch {
    // ok — ambiente local; lixo não importa.
  }
})

describe('MinioStorageAdapter (integração)', () => {
  it('faz round-trip put → head → get → delete', async () => {
    if (!minioReachable) return
    const key = `tenant-x/lab/owner-y/2026/04/${randomUUID()}.txt`
    const body = new TextEncoder().encode('hello LogiFit')

    const put = await adapter.put({
      bucket: BUCKETS.LAB_DOCUMENTS,
      key,
      body,
      contentType: 'text/plain',
      metadata: { tenant: 'x', module: 'lab' },
    })
    expect(put.key).toBe(key)
    expect(put.etag.length).toBeGreaterThan(0)

    const head = await adapter.head({ bucket: BUCKETS.LAB_DOCUMENTS, key })
    expect(head).not.toBeNull()
    expect(head?.size).toBe(body.byteLength)
    expect(head?.contentType).toBe('text/plain')

    const got = await adapter.get({ bucket: BUCKETS.LAB_DOCUMENTS, key })
    const roundTripped = await readStreamToBuffer(got.body)
    expect(new TextDecoder().decode(roundTripped)).toBe('hello LogiFit')

    await adapter.delete({ bucket: BUCKETS.LAB_DOCUMENTS, key })
    const headAfter = await adapter.head({ bucket: BUCKETS.LAB_DOCUMENTS, key })
    expect(headAfter).toBeNull()
  })

  it('list retorna objetos por prefixo', async () => {
    if (!minioReachable) return
    const tenant = `tenant-${randomUUID().slice(0, 6)}`
    for (let i = 0; i < 3; i++) {
      await adapter.put({
        bucket: BUCKETS.LAB_DOCUMENTS,
        key: `${tenant}/file-${i}.txt`,
        body: new TextEncoder().encode(String(i)),
        contentType: 'text/plain',
      })
    }
    const items = await adapter.list({ bucket: BUCKETS.LAB_DOCUMENTS, prefix: `${tenant}/` })
    expect(items.length).toBe(3)
    for (const item of items) {
      expect(item.key.startsWith(`${tenant}/`)).toBe(true)
    }
  })

  it('presignGet retorna URL acessível via fetch', async () => {
    if (!minioReachable) return
    const key = `tenant-z/${randomUUID()}.txt`
    await adapter.put({
      bucket: BUCKETS.LAB_DOCUMENTS,
      key,
      body: new TextEncoder().encode('presigned'),
      contentType: 'text/plain',
    })
    const url = await adapter.presignGet({
      bucket: BUCKETS.LAB_DOCUMENTS,
      key,
      ttlSeconds: 60,
    })
    expect(url.startsWith('http')).toBe(true)
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('presigned')
  })

  it('head retorna null em chave inexistente (não joga)', async () => {
    if (!minioReachable) return
    const head = await adapter.head({
      bucket: BUCKETS.LAB_DOCUMENTS,
      key: `nada/${randomUUID()}.txt`,
    })
    expect(head).toBeNull()
  })

  it('rejeita key com path traversal', async () => {
    if (!minioReachable) return
    await expect(
      adapter.put({
        bucket: BUCKETS.LAB_DOCUMENTS,
        key: 'tenant/../escape.txt',
        body: new TextEncoder().encode('x'),
        contentType: 'text/plain',
      }),
    ).rejects.toThrow()
  })

  it('rejeita bucket fora do enum', async () => {
    if (!minioReachable) return
    await expect(
      adapter.put({
        // @ts-expect-error — teste de runtime quando consumidor passa lixo
        bucket: 'nao-existe',
        key: 'x.txt',
        body: new TextEncoder().encode('x'),
        contentType: 'text/plain',
      }),
    ).rejects.toThrow()
  })

  it('traduz erro em StorageError quando bucket não existe', async () => {
    if (!minioReachable) return
    // `put` contra bucket inexistente surfa `NoSuchBucket` no AWS SDK; `head`
    // perde essa info porque HEAD não tem corpo (404 genérico). Por isso o
    // teste exercita escrita contra bucket inexistente — fluxo realista de
    // detecção de drift de configuração.
    const ghost = new MinioStorageAdapter({
      ...config,
      bucketPrefix: `logifit-ghost-${randomUUID().slice(0, 8)}`,
    })
    await expect(
      ghost.put({
        bucket: BUCKETS.LAB_DOCUMENTS,
        key: 'x.txt',
        body: new TextEncoder().encode('x'),
        contentType: 'text/plain',
      }),
    ).rejects.toBeInstanceOf(StorageError)
  })
})
