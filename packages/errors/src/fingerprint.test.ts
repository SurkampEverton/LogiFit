import { describe, expect, it } from 'vitest'
import { fingerprint } from './fingerprint'

describe('fingerprint', () => {
  it('retorna 16 hex chars', () => {
    const fp = fingerprint({ code: 'INTERNAL_ERROR', module: 'agenda' })
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('é determinístico (mesma entrada = mesmo output)', () => {
    const fp1 = fingerprint({ code: 'FORBIDDEN', module: 'financeiro', tenantId: 't1' })
    const fp2 = fingerprint({ code: 'FORBIDDEN', module: 'financeiro', tenantId: 't1' })
    expect(fp1).toBe(fp2)
  })

  it('código diferente → fingerprint diferente', () => {
    const fp1 = fingerprint({ code: 'A', module: 'm' })
    const fp2 = fingerprint({ code: 'B', module: 'm' })
    expect(fp1).not.toBe(fp2)
  })

  it('módulo diferente → fingerprint diferente', () => {
    const fp1 = fingerprint({ code: 'A', module: 'm1' })
    const fp2 = fingerprint({ code: 'A', module: 'm2' })
    expect(fp1).not.toBe(fp2)
  })

  it('tenantId diferente → fingerprint diferente (anti-colisão multi-tenant)', () => {
    const fp1 = fingerprint({ code: 'A', module: 'm', tenantId: 't1' })
    const fp2 = fingerprint({ code: 'A', module: 'm', tenantId: 't2' })
    expect(fp1).not.toBe(fp2)
  })

  it('signal diferente → fingerprint diferente', () => {
    const fp1 = fingerprint({ code: 'A', module: 'm', signal: 's1' })
    const fp2 = fingerprint({ code: 'A', module: 'm', signal: 's2' })
    expect(fp1).not.toBe(fp2)
  })

  it('sem tenantId usa "global" como sentinel', () => {
    const fp1 = fingerprint({ code: 'A', module: 'm' })
    const fp2 = fingerprint({ code: 'A', module: 'm', tenantId: 'global' })
    expect(fp1).toBe(fp2)
  })

  it('separator \\0 evita colisão tipo "abc" + "def" === "ab" + "cdef"', () => {
    const fp1 = fingerprint({ code: 'abc', module: 'def' })
    const fp2 = fingerprint({ code: 'ab', module: 'cdef' })
    expect(fp1).not.toBe(fp2)
  })
})
