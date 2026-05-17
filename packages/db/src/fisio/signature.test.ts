/**
 * signature.ts tests — Sprint 20 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  hashConsultaContent,
  resolveSignaturePolicy,
  validateCidCode,
  validateCifCode,
  validateCifQualifier,
  validateLockAttempt,
  type SignaturePolicyRow,
  type TenantSignatureOverrideRow,
} from './signature'

const POLICIES: SignaturePolicyRow[] = [
  {
    profession: 'medico',
    mode: 'icp_required',
    minCertLevel: 'A3',
    requiresMfa: true,
    requiresAuditChain: true,
    requiresAuthenticatedSession: true,
    sourceNorm: 'CFM 2.299/2021',
    retentionYears: 20,
  },
  {
    profession: 'fisio',
    mode: 'authenticated_lock',
    minCertLevel: null,
    requiresMfa: true,
    requiresAuditChain: true,
    requiresAuthenticatedSession: true,
    sourceNorm: 'COFFITO 414/2012',
    retentionYears: 20,
  },
  {
    profession: 'nutri',
    mode: 'authenticated_lock',
    minCertLevel: null,
    requiresMfa: true,
    requiresAuditChain: true,
    requiresAuthenticatedSession: true,
    sourceNorm: 'CFN 599/2018',
    retentionYears: 20,
  },
]

describe('resolveSignaturePolicy', () => {
  it('médico → icp_required A3', () => {
    const r = resolveSignaturePolicy({
      professionOrKind: 'medico',
      policies: POLICIES,
      tenantOverrides: [],
      tenantId: 'tenant-x',
    })
    expect(r.mode).toBe('icp_required')
    expect(r.minCertLevel).toBe('A3')
  })

  it('fisio → authenticated_lock (default)', () => {
    const r = resolveSignaturePolicy({
      professionOrKind: 'fisio',
      policies: POLICIES,
      tenantOverrides: [],
      tenantId: 'tenant-x',
    })
    expect(r.mode).toBe('authenticated_lock')
  })

  it('fisio com override do tenant → icp_required (endurece)', () => {
    const overrides: TenantSignatureOverrideRow[] = [
      { tenantId: 'tenant-hosp', profession: 'fisio', modeOverride: 'icp_required' },
    ]
    const r = resolveSignaturePolicy({
      professionOrKind: 'fisio',
      policies: POLICIES,
      tenantOverrides: overrides,
      tenantId: 'tenant-hosp',
    })
    expect(r.mode).toBe('icp_required')
    expect(r.minCertLevel).toBe('A1') // fallback do default
  })

  it('override de outro tenant ignorado', () => {
    const overrides: TenantSignatureOverrideRow[] = [
      { tenantId: 'tenant-other', profession: 'fisio', modeOverride: 'icp_required' },
    ]
    const r = resolveSignaturePolicy({
      professionOrKind: 'fisio',
      policies: POLICIES,
      tenantOverrides: overrides,
      tenantId: 'tenant-x',
    })
    expect(r.mode).toBe('authenticated_lock')
  })

  it('custom → fallback fisio (conservador)', () => {
    const r = resolveSignaturePolicy({
      professionOrKind: 'custom',
      policies: POLICIES,
      tenantOverrides: [],
      tenantId: 'tenant-x',
    })
    expect(r.mode).toBe('authenticated_lock')
  })

  it('profession sem entrada → throw', () => {
    expect(() =>
      resolveSignaturePolicy({
        professionOrKind: 'dentista',
        policies: POLICIES,
        tenantOverrides: [],
        tenantId: 'tenant-x',
      }),
    ).toThrow(/dentista/)
  })
})

describe('validateLockAttempt', () => {
  const fisioPolicy = POLICIES.find((p) => p.profession === 'fisio')!
  const medicoPolicy = POLICIES.find((p) => p.profession === 'medico')!

  it('médico com A3 + MFA recente + council ativo → OK', () => {
    const r = validateLockAttempt({
      policy: medicoPolicy,
      attempt: 'icp_brasil_a3',
      mfaRecentMs: 60_000,
      hasActiveCouncil: true,
    })
    expect(r.ok).toBe(true)
  })

  it('médico tentando lacre autenticado → falha (icp_required)', () => {
    const r = validateLockAttempt({
      policy: medicoPolicy,
      attempt: 'authenticated_mfa',
      mfaRecentMs: 60_000,
      hasActiveCouncil: true,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('ICP-Brasil')
  })

  it('médico com A1 (cert level baixo) → falha quando minCertLevel=A3', () => {
    const r = validateLockAttempt({
      policy: medicoPolicy,
      attempt: 'icp_brasil_a1',
      mfaRecentMs: 60_000,
      hasActiveCouncil: true,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('A3')
  })

  it('fisio com lacre autenticado + MFA recente → OK', () => {
    const r = validateLockAttempt({
      policy: fisioPolicy,
      attempt: 'authenticated_mfa',
      mfaRecentMs: 60_000,
      hasActiveCouncil: true,
    })
    expect(r.ok).toBe(true)
  })

  it('fisio sem MFA recente → falha', () => {
    const r = validateLockAttempt({
      policy: fisioPolicy,
      attempt: 'authenticated_mfa',
      mfaRecentMs: 30 * 60 * 1000, // 30 min
      hasActiveCouncil: true,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('MFA')
  })

  it('fisio sem CREFITO ativo → falha mesmo com ICP-Brasil', () => {
    const r = validateLockAttempt({
      policy: fisioPolicy,
      attempt: 'icp_brasil_a3',
      mfaRecentMs: 60_000,
      hasActiveCouncil: false,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('conselho')
  })
})

describe('hashConsultaContent', () => {
  it('mesmo input → mesmo hash (determinístico)', () => {
    const input = {
      content: { queixa: 'dor lombar', avaliacao: 'EVA 7/10' },
      cids: [{ code: 'MG30.0', kind: 'principal' }],
      cifs: [{ code: 'b280', qualifier: 2 }],
      signedAtIso: '2026-05-17T15:00:00.000Z',
      professionalUserId: 'user-123',
    }
    expect(hashConsultaContent(input)).toBe(hashConsultaContent(input))
  })

  it('chaves em ordem diferente → mesmo hash (canônico)', () => {
    const h1 = hashConsultaContent({
      content: { a: 1, b: 2 },
      cids: [],
      cifs: [],
      signedAtIso: '2026-05-17T15:00:00.000Z',
      professionalUserId: 'u',
    })
    const h2 = hashConsultaContent({
      content: { b: 2, a: 1 },
      cids: [],
      cifs: [],
      signedAtIso: '2026-05-17T15:00:00.000Z',
      professionalUserId: 'u',
    })
    expect(h1).toBe(h2)
  })

  it('CIDs em ordem diferente → mesmo hash', () => {
    const cids1 = [
      { code: 'MG30.0', kind: 'principal' },
      { code: 'FB20', kind: 'secundario' },
    ]
    const cids2 = [
      { code: 'FB20', kind: 'secundario' },
      { code: 'MG30.0', kind: 'principal' },
    ]
    const h1 = hashConsultaContent({
      content: {},
      cids: cids1,
      cifs: [],
      signedAtIso: '2026-05-17T15:00:00.000Z',
      professionalUserId: 'u',
    })
    const h2 = hashConsultaContent({
      content: {},
      cids: cids2,
      cifs: [],
      signedAtIso: '2026-05-17T15:00:00.000Z',
      professionalUserId: 'u',
    })
    expect(h1).toBe(h2)
  })

  it('mudança em content → hash diferente', () => {
    const base = {
      content: { queixa: 'A' },
      cids: [],
      cifs: [],
      signedAtIso: '2026-05-17T15:00:00.000Z',
      professionalUserId: 'u',
    }
    const h1 = hashConsultaContent(base)
    const h2 = hashConsultaContent({ ...base, content: { queixa: 'B' } })
    expect(h1).not.toBe(h2)
  })

  it('hash é sha256 hex (64 chars)', () => {
    const h = hashConsultaContent({
      content: {},
      cids: [],
      cifs: [],
      signedAtIso: '2026-05-17T15:00:00.000Z',
      professionalUserId: 'u',
    })
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('validateCidCode', () => {
  it('CID-11 válido aceito', () => {
    expect(validateCidCode('MG30.0').ok).toBe(true)
    expect(validateCidCode('FB20').ok).toBe(true)
    expect(validateCidCode('BA00').ok).toBe(true)
  })

  it('CID com lowercase rejeitado', () => {
    expect(validateCidCode('mg30.0').ok).toBe(false)
  })

  it('CID vazio rejeitado', () => {
    expect(validateCidCode('').ok).toBe(false)
  })

  it('CID muito longo rejeitado', () => {
    expect(validateCidCode('A'.repeat(13)).ok).toBe(false)
  })
})

describe('validateCifCode', () => {
  it('CIF padrão aceito', () => {
    expect(validateCifCode('b280').ok).toBe(true)
    expect(validateCifCode('d450').ok).toBe(true)
    expect(validateCifCode('s7300.21').ok).toBe(true)
    expect(validateCifCode('e310').ok).toBe(true)
  })

  it('CIF componente inválido (a000) rejeitado', () => {
    expect(validateCifCode('a000').ok).toBe(false)
  })

  it('CIF sem dígitos suficientes rejeitado', () => {
    expect(validateCifCode('b28').ok).toBe(false)
  })
})

describe('validateCifQualifier', () => {
  it('0-4 aceito', () => {
    for (let i = 0; i <= 4; i++) expect(validateCifQualifier(i).ok).toBe(true)
  })

  it('5 ou -1 rejeitado', () => {
    expect(validateCifQualifier(5).ok).toBe(false)
    expect(validateCifQualifier(-1).ok).toBe(false)
  })

  it('decimal rejeitado', () => {
    expect(validateCifQualifier(2.5).ok).toBe(false)
  })
})
