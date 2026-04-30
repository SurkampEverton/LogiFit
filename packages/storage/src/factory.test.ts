/**
 * Testes de unidade do `factory` — sem MinIO real, só validação de env.
 */

import { describe, expect, it } from 'vitest'
import { createStorageAdapter, readStorageEnv } from './factory'
import { StorageError } from './types'

describe('readStorageEnv', () => {
  it('aceita env completa', () => {
    const env = readStorageEnv({
      MINIO_ENDPOINT: 'http://localhost:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin',
      MINIO_REGION: 'sa-east-1',
      MINIO_BUCKET_PREFIX: 'logifit-dev',
    } as NodeJS.ProcessEnv)
    expect(env.MINIO_BUCKET_PREFIX).toBe('logifit-dev')
  })

  it('aplica defaults a region/prefix', () => {
    const env = readStorageEnv({
      MINIO_ENDPOINT: 'http://localhost:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin',
    } as NodeJS.ProcessEnv)
    expect(env.MINIO_REGION).toBe('sa-east-1')
    expect(env.MINIO_BUCKET_PREFIX).toBe('logifit-dev')
  })

  it('falha com endpoint não-URL', () => {
    expect(() =>
      readStorageEnv({
        MINIO_ENDPOINT: 'nao-url',
        MINIO_ACCESS_KEY: 'minioadmin',
        MINIO_SECRET_KEY: 'minioadmin',
      } as NodeJS.ProcessEnv),
    ).toThrow(StorageError)
  })

  it('falha com access key vazio', () => {
    expect(() =>
      readStorageEnv({
        MINIO_ENDPOINT: 'http://localhost:9000',
        MINIO_ACCESS_KEY: '',
        MINIO_SECRET_KEY: 'minioadmin',
      } as NodeJS.ProcessEnv),
    ).toThrow(StorageError)
  })
})

describe('createStorageAdapter', () => {
  it('constrói adapter com forcePathStyle e prefix corretos', () => {
    const adapter = createStorageAdapter({
      MINIO_ENDPOINT: 'http://localhost:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin',
      MINIO_BUCKET_PREFIX: 'logifit-x',
    } as NodeJS.ProcessEnv)
    expect(adapter.config.bucketPrefix).toBe('logifit-x')
    expect(adapter.config.forcePathStyle).toBe(true)
    expect(adapter.config.endpoint).toBe('http://localhost:9000')
  })

  it('falha cedo se env inválida', () => {
    expect(() => createStorageAdapter({} as NodeJS.ProcessEnv)).toThrow(StorageError)
  })
})
