/**
 * QR HMAC tests — Sprint 08 Faixa B.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateAccessSecret, generateAccessToken, validateAccessToken } from './access-qr'

const MEMBER_ID = '77777777-bbbb-bbbb-bbbb-000000000001'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('access-qr', () => {
  it('generate + validate round-trip OK', () => {
    const secret = generateAccessSecret()
    const token = generateAccessToken(MEMBER_ID, secret)
    expect(token).toMatch(/^[a-f0-9-]+\.\d+\.[a-f0-9]{16}$/)
    const result = validateAccessToken(token, [secret])
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.memberId).toBe(MEMBER_ID)
  })

  it('token de outro secret falha', () => {
    const secret1 = generateAccessSecret()
    const secret2 = generateAccessSecret()
    const token = generateAccessToken(MEMBER_ID, secret1)
    const result = validateAccessToken(token, [secret2])
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('invalid_hmac')
  })

  it('token de janela anterior (30s ago) aceita (tolerância)', () => {
    const secret = generateAccessSecret()
    const token = generateAccessToken(MEMBER_ID, secret)
    // Avança 50s — ainda mesma janela
    vi.advanceTimersByTime(50_000)
    const r1 = validateAccessToken(token, [secret])
    expect(r1.valid).toBe(true)
    // Avança +20s → 70s total → janela seguinte; token original ainda OK (tolerance=1)
    vi.advanceTimersByTime(20_000)
    const r2 = validateAccessToken(token, [secret])
    expect(r2.valid).toBe(true)
  })

  it('token expirado (>2 janelas = 120s) rejeitado', () => {
    const secret = generateAccessSecret()
    const token = generateAccessToken(MEMBER_ID, secret)
    vi.advanceTimersByTime(125_000) // > 2 windows
    const result = validateAccessToken(token, [secret])
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('expired_or_future')
  })

  it('multiplos secrets ativos (rotação) — aceita ambos', () => {
    const secretOld = generateAccessSecret()
    const secretNew = generateAccessSecret()
    const tokenOld = generateAccessToken(MEMBER_ID, secretOld)
    const tokenNew = generateAccessToken(MEMBER_ID, secretNew)
    // Catraca passa ambos secrets ativos
    const r1 = validateAccessToken(tokenOld, [secretNew, secretOld])
    const r2 = validateAccessToken(tokenNew, [secretNew, secretOld])
    expect(r1.valid).toBe(true)
    expect(r2.valid).toBe(true)
  })

  it('token malformado rejeitado', () => {
    const cases = ['', 'nada', 'a.b', 'a.b.c.d']
    for (const t of cases) {
      const r = validateAccessToken(t, ['any-secret'])
      expect(r.valid).toBe(false)
    }
  })

  it('windowStart não-numérico rejeitado', () => {
    const r = validateAccessToken(`${MEMBER_ID}.abc.0123456789abcdef`, ['any-secret'])
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.reason).toBe('invalid_window')
  })

  it('generateAccessToken throws sem secret', () => {
    expect(() => generateAccessToken(MEMBER_ID, '')).toThrow()
  })

  it('token futuro (window > now) rejeitado', () => {
    const secret = generateAccessSecret()
    const token = generateAccessToken(MEMBER_ID, secret)
    // Volta tempo 5 minutos — token agora "no futuro"
    vi.setSystemTime(new Date('2026-06-01T11:55:00Z'))
    const result = validateAccessToken(token, [secret])
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('expired_or_future')
  })

  it('timing-safe comparison (mesmo length diferente content)', () => {
    const secret = generateAccessSecret()
    const tokenValid = generateAccessToken(MEMBER_ID, secret)
    // Modifica último char do hmac mantendo length
    const tokenTampered = `${tokenValid.slice(0, -1)}0`
    const result = validateAccessToken(tokenTampered, [secret])
    expect(result.valid).toBe(false)
  })
})
