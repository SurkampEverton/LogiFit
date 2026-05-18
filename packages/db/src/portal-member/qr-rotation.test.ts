/**
 * qr-rotation.ts tests — Sprint 26 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  decodeQrString,
  encodeQrString,
  generateQrPayload,
  QR_ROTATION_WINDOW_MS,
  verifyQrPayload,
} from './qr-rotation'

const SECRET = 'shared-device-secret-deadbeef'
const MEMBER = '00000000-0000-0000-0000-000000000001'
const TENANT = '00000001-0001-0000-0000-000000000010'

describe('generateQrPayload', () => {
  it('gera payload com window + signature', () => {
    const r = generateQrPayload({
      memberId: MEMBER,
      tenantId: TENANT,
      secret: SECRET,
      now: new Date('2026-05-17T12:00:00Z'),
    })
    expect(r.memberId).toBe(MEMBER)
    expect(r.tenantId).toBe(TENANT)
    expect(r.signature).toHaveLength(32)
    expect(r.window).toBeGreaterThan(0)
  })

  it('window é determinístico no mesmo minuto', () => {
    const a = generateQrPayload({
      memberId: MEMBER,
      tenantId: TENANT,
      secret: SECRET,
      now: new Date('2026-05-17T12:00:30Z'),
    })
    const b = generateQrPayload({
      memberId: MEMBER,
      tenantId: TENANT,
      secret: SECRET,
      now: new Date('2026-05-17T12:00:59Z'),
    })
    expect(a.window).toBe(b.window)
    expect(a.signature).toBe(b.signature)
  })

  it('window muda no próximo minuto', () => {
    const a = generateQrPayload({
      memberId: MEMBER,
      tenantId: TENANT,
      secret: SECRET,
      now: new Date('2026-05-17T12:00:59Z'),
    })
    const b = generateQrPayload({
      memberId: MEMBER,
      tenantId: TENANT,
      secret: SECRET,
      now: new Date('2026-05-17T12:01:00Z'),
    })
    expect(a.window + 1).toBe(b.window)
    expect(a.signature).not.toBe(b.signature)
  })
})

describe('verifyQrPayload', () => {
  it('payload válido na mesma janela → ok', () => {
    const now = new Date('2026-05-17T12:00:00Z')
    const p = generateQrPayload({ memberId: MEMBER, tenantId: TENANT, secret: SECRET, now })
    const r = verifyQrPayload({ payload: p, secret: SECRET, now })
    expect(r.ok).toBe(true)
  })

  it('payload da janela anterior (±1) ainda OK', () => {
    const gen = new Date('2026-05-17T12:00:00Z')
    const verify = new Date('2026-05-17T12:01:30Z') // ~1.5min depois
    const p = generateQrPayload({ memberId: MEMBER, tenantId: TENANT, secret: SECRET, now: gen })
    const r = verifyQrPayload({ payload: p, secret: SECRET, now: verify })
    expect(r.ok).toBe(true)
  })

  it('payload muito antigo (3 janelas) → expired', () => {
    const gen = new Date('2026-05-17T12:00:00Z')
    const verify = new Date('2026-05-17T12:05:00Z') // 5min depois
    const p = generateQrPayload({ memberId: MEMBER, tenantId: TENANT, secret: SECRET, now: gen })
    const r = verifyQrPayload({ payload: p, secret: SECRET, now: verify })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('expired')
  })

  it('signature errada → invalid_signature', () => {
    const now = new Date('2026-05-17T12:00:00Z')
    const p = generateQrPayload({ memberId: MEMBER, tenantId: TENANT, secret: SECRET, now })
    const tampered = { ...p, signature: 'a'.repeat(32) }
    const r = verifyQrPayload({ payload: tampered, secret: SECRET, now })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_signature')
  })

  it('secret errado → invalid_signature', () => {
    const now = new Date('2026-05-17T12:00:00Z')
    const p = generateQrPayload({ memberId: MEMBER, tenantId: TENANT, secret: SECRET, now })
    const r = verifyQrPayload({ payload: p, secret: 'outro-secret', now })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_signature')
  })
})

describe('encode/decodeQrString', () => {
  it('round-trip preserva payload', () => {
    const p = generateQrPayload({
      memberId: MEMBER,
      tenantId: TENANT,
      secret: SECRET,
      now: new Date('2026-05-17T12:00:00Z'),
    })
    const encoded = encodeQrString(p)
    expect(encoded.startsWith('LF|')).toBe(true)
    const decoded = decodeQrString(encoded)
    expect(decoded).toEqual(p)
  })

  it('decode string inválida retorna null', () => {
    expect(decodeQrString('not-our-format')).toBeNull()
    expect(decodeQrString('LF|too|few|parts')).toBeNull()
    expect(decodeQrString('LF|m|t|notanumber|sig')).toBeNull()
  })
})

describe('QR_ROTATION_WINDOW_MS', () => {
  it('é 60s', () => {
    expect(QR_ROTATION_WINDOW_MS).toBe(60_000)
  })
})
