/**
 * Testes de unidade do `tenantKey` — não dependem de MinIO.
 */

import { describe, expect, it } from 'vitest'
import { keyBelongsToTenant, tenantKey } from './tenant-key'
import { StorageError } from './types'

const TENANT_OK = '550e8400-e29b-41d4-a716-446655440000'
const OWNER_OK = '6ba7b810-9dad-41d1-80b4-00c04fd430c8'

describe('tenantKey', () => {
  it('compõe chave canônica com UUID + ano/mês', () => {
    const fixed = new Date('2026-04-29T10:00:00Z')
    const result = tenantKey({
      tenantId: TENANT_OK,
      ownerKind: 'member',
      ownerId: OWNER_OK,
      ext: 'pdf',
      now: fixed,
    })
    expect(result.key).toMatch(
      new RegExp(`^${TENANT_OK}/member/${OWNER_OK}/2026/04/[0-9a-f-]{36}\\.pdf$`),
    )
    expect(result.uuid).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejeita tenantId não-UUID', () => {
    expect(() =>
      tenantKey({
        tenantId: 'not-uuid',
        ownerKind: 'member',
        ownerId: OWNER_OK,
        ext: 'pdf',
      }),
    ).toThrow(StorageError)
  })

  it('rejeita ownerId não-UUID', () => {
    expect(() =>
      tenantKey({
        tenantId: TENANT_OK,
        ownerKind: 'member',
        ownerId: 'invalido',
        ext: 'pdf',
      }),
    ).toThrow(StorageError)
  })

  it('rejeita ownerKind com caractere proibido', () => {
    expect(() =>
      tenantKey({
        tenantId: TENANT_OK,
        ownerKind: 'Member',
        ownerId: OWNER_OK,
        ext: 'pdf',
      }),
    ).toThrow(/ownerKind/)
  })

  it('rejeita extensão fora da allowlist', () => {
    expect(() =>
      tenantKey({
        tenantId: TENANT_OK,
        ownerKind: 'member',
        ownerId: OWNER_OK,
        // @ts-expect-error teste runtime
        ext: 'exe',
      }),
    ).toThrow(/extensão/)
  })
})

describe('keyBelongsToTenant', () => {
  it('aceita chave com prefixo do tenant', () => {
    expect(keyBelongsToTenant(`${TENANT_OK}/foo/bar.pdf`, TENANT_OK)).toBe(true)
  })
  it('rejeita chave sem prefixo do tenant', () => {
    expect(keyBelongsToTenant('outro/foo.pdf', TENANT_OK)).toBe(false)
  })
  it('rejeita prefixo igual mas sem barra (anti substring)', () => {
    expect(keyBelongsToTenant(`${TENANT_OK}-x/foo.pdf`, TENANT_OK)).toBe(false)
  })
})
