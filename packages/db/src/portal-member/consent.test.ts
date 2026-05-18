/**
 * consent.ts tests — Sprint 26 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  CONSENT_CATALOG,
  checkRenewalStatus,
  pickConsentsNeedingRenewal,
} from './consent'

describe('CONSENT_CATALOG', () => {
  it('5 finalidades canônicas', () => {
    expect(Object.keys(CONSENT_CATALOG)).toEqual(
      expect.arrayContaining([
        'marketing',
        'cross_module_share',
        'analytics_anon',
        'photo_use',
        'whatsapp_promotional',
      ]),
    )
  })

  it('cada finalidade tem labelPt + impactWhenRevokedPt', () => {
    for (const key of Object.keys(CONSENT_CATALOG)) {
      const meta = CONSENT_CATALOG[key as keyof typeof CONSENT_CATALOG]
      expect(meta.labelPt.length).toBeGreaterThan(10)
      expect(meta.impactWhenRevokedPt.length).toBeGreaterThan(20)
    }
  })

  it('marketing/cross_module_share renovam em 12 meses', () => {
    expect(CONSENT_CATALOG.marketing.renewalMonths).toBe(12)
    expect(CONSENT_CATALOG.cross_module_share.renewalMonths).toBe(12)
  })

  it('analytics_anon nunca expira', () => {
    expect(CONSENT_CATALOG.analytics_anon.renewalMonths).toBeNull()
  })

  it('photo_use renova em 24 meses', () => {
    expect(CONSENT_CATALOG.photo_use.renewalMonths).toBe(24)
  })
})

describe('checkRenewalStatus', () => {
  const NOW = new Date('2026-05-17T12:00:00Z')

  it('granted há 2 meses (12m total) → active', () => {
    const r = checkRenewalStatus(
      [{ purpose: 'marketing', grantedAt: '2026-03-17T12:00:00Z', revokedAt: null }],
      NOW,
    )
    expect(r[0]!.status).toBe('active')
    expect(r[0]!.daysUntilExpiry).toBeGreaterThan(200)
  })

  it('granted há 11.5 meses → expiring_soon', () => {
    const r = checkRenewalStatus(
      [{ purpose: 'marketing', grantedAt: '2025-05-31T12:00:00Z', revokedAt: null }],
      NOW,
    )
    expect(r[0]!.status).toBe('expiring_soon')
  })

  it('granted há 13 meses → expired', () => {
    const r = checkRenewalStatus(
      [{ purpose: 'marketing', grantedAt: '2025-04-01T12:00:00Z', revokedAt: null }],
      NOW,
    )
    expect(r[0]!.status).toBe('expired')
    expect(r[0]!.daysUntilExpiry).toBeLessThanOrEqual(0)
  })

  it('revoked → status=revoked', () => {
    const r = checkRenewalStatus(
      [
        {
          purpose: 'marketing',
          grantedAt: '2026-03-17T12:00:00Z',
          revokedAt: '2026-05-10T12:00:00Z',
        },
      ],
      NOW,
    )
    expect(r[0]!.status).toBe('revoked')
  })

  it('analytics_anon nunca expira mesmo após muito tempo', () => {
    const r = checkRenewalStatus(
      [{ purpose: 'analytics_anon', grantedAt: '2020-01-01T12:00:00Z', revokedAt: null }],
      NOW,
    )
    expect(r[0]!.status).toBe('active')
    expect(r[0]!.daysUntilExpiry).toBeNull()
  })
})

describe('pickConsentsNeedingRenewal', () => {
  it('filtra expiring_soon + expired', () => {
    const r = pickConsentsNeedingRenewal([
      { purpose: 'marketing', status: 'active', daysUntilExpiry: 200 },
      { purpose: 'cross_module_share', status: 'expiring_soon', daysUntilExpiry: 15 },
      { purpose: 'photo_use', status: 'expired', daysUntilExpiry: -10 },
      { purpose: 'analytics_anon', status: 'revoked', daysUntilExpiry: null },
    ])
    expect(r).toHaveLength(2)
    expect(r.map((c) => c.purpose).sort()).toEqual(['cross_module_share', 'photo_use'])
  })
})
