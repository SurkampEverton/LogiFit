import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isMfaRecent,
  MfaRecentRequiredError,
  requireRecentMfa,
  requireRecentMfaForAction,
} from './require-recent-mfa'

describe('requireRecentMfa', () => {
  const NOW = new Date('2026-05-12T18:00:00Z')
  const AUTH_USER_ID = 'auth_user_abc123'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('aceita MFA <15min (default)', () => {
    const session = {
      mfaAt: new Date(NOW.getTime() - 10 * 60_000), // 10min atrás
      authUserId: AUTH_USER_ID,
    }
    expect(() => requireRecentMfa(session)).not.toThrow()
  })

  it('aceita MFA exatamente 15min (limite)', () => {
    const session = {
      mfaAt: new Date(NOW.getTime() - 15 * 60_000),
      authUserId: AUTH_USER_ID,
    }
    expect(() => requireRecentMfa(session)).not.toThrow()
  })

  it('rejeita MFA >15min', () => {
    const session = {
      mfaAt: new Date(NOW.getTime() - 16 * 60_000),
      authUserId: AUTH_USER_ID,
    }
    expect(() => requireRecentMfa(session)).toThrow(MfaRecentRequiredError)
  })

  it('rejeita mfaAt null', () => {
    const session = { mfaAt: null, authUserId: AUTH_USER_ID }
    try {
      requireRecentMfa(session)
      expect.fail('deveria ter lançado')
    } catch (err) {
      expect(err).toBeInstanceOf(MfaRecentRequiredError)
      expect((err as MfaRecentRequiredError).code).toBe('MFA_RECENT_REQUIRED')
      expect((err as MfaRecentRequiredError).mfaAt).toBeNull()
    }
  })

  it('respeita maxAgeMins customizado (5min — ultra-sensível)', () => {
    const session = {
      mfaAt: new Date(NOW.getTime() - 6 * 60_000),
      authUserId: AUTH_USER_ID,
    }
    expect(() => requireRecentMfa(session, { maxAgeMins: 5 })).toThrow(MfaRecentRequiredError)
    // mas com default 15 passa
    expect(() => requireRecentMfa(session)).not.toThrow()
  })

  it('error carrega maxAgeMins + mfaAt pra UI mostrar', () => {
    const mfaAt = new Date(NOW.getTime() - 30 * 60_000)
    const session = { mfaAt, authUserId: AUTH_USER_ID }
    try {
      requireRecentMfa(session, { maxAgeMins: 10 })
      expect.fail('deveria ter lançado')
    } catch (err) {
      const e = err as MfaRecentRequiredError
      expect(e.maxAgeMins).toBe(10)
      expect(e.mfaAt).toEqual(mfaAt)
    }
  })
})

describe('requireRecentMfaForAction', () => {
  const NOW = new Date('2026-05-12T18:00:00Z')
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('checa cancelNfe (high-risk) → exige MFA recente', () => {
    const session = { mfaAt: null, authUserId: 'u1' }
    expect(() => requireRecentMfaForAction(session, 'cancelNfe')).toThrow(MfaRecentRequiredError)
  })

  it('passa em ação não-listada (não-high-risk)', () => {
    const session = { mfaAt: null, authUserId: 'u1' }
    expect(() => requireRecentMfaForAction(session, 'createMember')).not.toThrow()
  })

  it('respeita maxAgeMins da lookup table', () => {
    // todas as actions atuais têm requireMfaMaxAgeMins=15
    const session = {
      mfaAt: new Date(NOW.getTime() - 14 * 60_000),
      authUserId: 'u1',
    }
    expect(() => requireRecentMfaForAction(session, 'cancelTissGuide')).not.toThrow()
  })
})

describe('isMfaRecent (helper UI)', () => {
  const NOW = new Date('2026-05-12T18:00:00Z')
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('true pra MFA <15min', () => {
    const session = { mfaAt: new Date(NOW.getTime() - 5 * 60_000), authUserId: 'u' }
    expect(isMfaRecent(session)).toBe(true)
  })

  it('false pra MFA >15min', () => {
    const session = { mfaAt: new Date(NOW.getTime() - 20 * 60_000), authUserId: 'u' }
    expect(isMfaRecent(session)).toBe(false)
  })

  it('false pra mfaAt null', () => {
    expect(isMfaRecent({ mfaAt: null, authUserId: 'u' })).toBe(false)
  })

  it('false pra session null (helper conveniente)', () => {
    expect(isMfaRecent(null)).toBe(false)
  })
})
