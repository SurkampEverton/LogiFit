/**
 * magic-link.ts tests — Sprint 26 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  MAGIC_LINK_MAX_PER_WINDOW,
  MAGIC_LINK_THROTTLE_SECONDS,
  MAGIC_LINK_TTL_MS,
  MEMBER_SESSION_TTL_MS,
  buildMagicLinkUrl,
  generateMagicLink,
  generateRefreshToken,
  hashToken,
  shouldRateLimit,
  verifyMagicLinkAgainstRow,
} from './magic-link'

describe('generateMagicLink', () => {
  it('gera token + hash + expiresAt 15min', () => {
    const now = new Date('2026-05-17T12:00:00Z')
    const r = generateMagicLink(now)
    expect(r.token.length).toBeGreaterThan(20)
    expect(r.tokenHash).toHaveLength(64) // sha256 hex
    expect(new Date(r.expiresAt).getTime() - now.getTime()).toBe(MAGIC_LINK_TTL_MS)
  })

  it('hash é determinístico (mesmo token = mesmo hash)', () => {
    const r = generateMagicLink()
    expect(hashToken(r.token)).toBe(r.tokenHash)
  })

  it('tokens são únicos entre chamadas (random)', () => {
    const a = generateMagicLink()
    const b = generateMagicLink()
    expect(a.token).not.toBe(b.token)
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })
})

describe('generateRefreshToken', () => {
  it('TTL 30d', () => {
    const now = new Date('2026-05-17T12:00:00Z')
    const r = generateRefreshToken(now)
    expect(new Date(r.expiresAt).getTime() - now.getTime()).toBe(MEMBER_SESSION_TTL_MS)
  })
})

describe('verifyMagicLinkAgainstRow', () => {
  const now = new Date('2026-05-17T12:00:00Z')
  const fresh = generateMagicLink(now)

  it('token válido + não expirado → ok', () => {
    const r = verifyMagicLinkAgainstRow(
      fresh.token,
      { tokenHash: fresh.tokenHash, expiresAt: fresh.expiresAt, usedAt: null },
      now,
    )
    expect(r.ok).toBe(true)
  })

  it('token usado (used_at != null) → reason=used', () => {
    const r = verifyMagicLinkAgainstRow(
      fresh.token,
      { tokenHash: fresh.tokenHash, expiresAt: fresh.expiresAt, usedAt: '2026-05-17T12:05:00Z' },
      now,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('used')
  })

  it('token expirado → reason=expired', () => {
    const later = new Date('2026-05-17T12:30:00Z') // 30min > TTL 15min
    const r = verifyMagicLinkAgainstRow(
      fresh.token,
      { tokenHash: fresh.tokenHash, expiresAt: fresh.expiresAt, usedAt: null },
      later,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('expired')
  })

  it('token hash não bate → reason=invalid_format', () => {
    const r = verifyMagicLinkAgainstRow(
      'outro-token-totalmente-diferente',
      { tokenHash: fresh.tokenHash, expiresAt: fresh.expiresAt, usedAt: null },
      now,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_format')
  })

  it('token vazio → reason=invalid_format', () => {
    const r = verifyMagicLinkAgainstRow(
      '',
      { tokenHash: fresh.tokenHash, expiresAt: fresh.expiresAt, usedAt: null },
      now,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_format')
  })
})

describe('shouldRateLimit', () => {
  it('primeira request → allowed', () => {
    const r = shouldRateLimit({ requestCount: 0, secondsSinceLast: null })
    expect(r.allowed).toBe(true)
  })

  it('< 60s desde última → throttle', () => {
    const r = shouldRateLimit({ requestCount: 1, secondsSinceLast: 30 })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('throttle')
    expect(r.retryAfterSeconds).toBe(30)
  })

  it('60s+ desde última, count < max → allowed', () => {
    const r = shouldRateLimit({ requestCount: 2, secondsSinceLast: 120 })
    expect(r.allowed).toBe(true)
  })

  it('count = max → bloqueado', () => {
    const r = shouldRateLimit({
      requestCount: MAGIC_LINK_MAX_PER_WINDOW,
      secondsSinceLast: 120,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('max_per_window')
  })

  it('throttle tem prioridade sobre max', () => {
    const r = shouldRateLimit({
      requestCount: MAGIC_LINK_MAX_PER_WINDOW,
      secondsSinceLast: 5,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('throttle')
  })

  it('throttle constant é 60s', () => {
    expect(MAGIC_LINK_THROTTLE_SECONDS).toBe(60)
  })
})

describe('buildMagicLinkUrl', () => {
  it('monta URL com token + redirect', () => {
    const url = buildMagicLinkUrl({
      tenantBaseUrl: 'https://academiax.logifit.com.br',
      token: 'abc123',
      redirectTo: '/meu/agenda',
    })
    expect(url).toContain('https://academiax.logifit.com.br/meu/login/verify')
    expect(url).toContain('t=abc123')
    expect(url).toContain('to=%2Fmeu%2Fagenda')
  })

  it('sem redirect → URL sem param to', () => {
    const url = buildMagicLinkUrl({
      tenantBaseUrl: 'https://academiax.logifit.com.br',
      token: 'xyz',
    })
    expect(url).toContain('t=xyz')
    expect(url).not.toContain('to=')
  })
})
