/**
 * envelope-crypto — unit tests (Sprint 04 Faixa B).
 *
 * Smoke tests round-trip + tamper detection.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  decryptSecret,
  decryptSecretParts,
  encryptSecret,
  encryptSecretParts,
  generateMasterKey,
} from './envelope-crypto'

beforeAll(() => {
  // Chave fixa pra tests (não é segredo real)
  process.env.LOGIFIT_DATA_KEY = generateMasterKey()
})

describe('envelope-crypto', () => {
  it('round-trip básico: encrypt → decrypt preserva texto', () => {
    const plain = 'sk_test_asaas_12345_abcdef'
    const encrypted = encryptSecret(plain)
    expect(encrypted).toMatch(/^enc:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/)
    expect(encrypted).not.toContain(plain)
    expect(decryptSecret(encrypted)).toBe(plain)
  })

  it('encrypts diferentes produzem ciphertext diferente (IV random)', () => {
    const plain = 'mesmo-texto'
    const e1 = encryptSecret(plain)
    const e2 = encryptSecret(plain)
    expect(e1).not.toBe(e2)
    expect(decryptSecret(e1)).toBe(plain)
    expect(decryptSecret(e2)).toBe(plain)
  })

  it('texto vazio → enc vazio (idempotente)', () => {
    expect(encryptSecret('')).toBe('')
    expect(decryptSecret('')).toBe('')
  })

  it('decryptSecret aceita plain text legado (sem prefix enc:)', () => {
    expect(decryptSecret('plain-text-sem-prefix')).toBe('plain-text-sem-prefix')
  })

  it('tampering no ciphertext → throws', () => {
    const encrypted = encryptSecret('segredo-importante')
    const tampered = `${encrypted.slice(0, -4)}AAAA`
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('formato malformado → throws', () => {
    expect(() => decryptSecret('enc:v1:apenas-duas-partes')).toThrow(/formato inválido/)
  })

  it('chave errada → throws decrypt failed', () => {
    const enc = encryptSecret('teste')
    const savedKey = process.env.LOGIFIT_DATA_KEY
    process.env.LOGIFIT_DATA_KEY = generateMasterKey()
    expect(() => decryptSecret(enc)).toThrow(/decrypt failed/)
    process.env.LOGIFIT_DATA_KEY = savedKey
  })

  it('texto longo (1KB) preserva', () => {
    const plain = 'a'.repeat(1024)
    const encrypted = encryptSecret(plain)
    expect(decryptSecret(encrypted)).toBe(plain)
  })

  it('caracteres especiais UTF-8 preservam', () => {
    const plain = 'açúcar 🔑 中文 ﻩ'
    expect(decryptSecret(encryptSecret(plain))).toBe(plain)
  })
})

describe('envelope-crypto columnar (Sprint 36b)', () => {
  it('round-trip: encryptSecretParts → decryptSecretParts preserva texto', () => {
    const plain = 'focus-nfe-token-abc123'
    const parts = encryptSecretParts(plain)
    expect(parts.encrypted).not.toContain(plain)
    expect(Buffer.from(parts.nonce, 'base64')).toHaveLength(12)
    expect(Buffer.from(parts.tag, 'base64')).toHaveLength(16)
    expect(decryptSecretParts(parts)).toBe(plain)
  })

  it('nonces diferentes a cada encrypt', () => {
    const p1 = encryptSecretParts('mesmo')
    const p2 = encryptSecretParts('mesmo')
    expect(p1.nonce).not.toBe(p2.nonce)
    expect(p1.encrypted).not.toBe(p2.encrypted)
  })

  it('tag adulterada → throws (tampering)', () => {
    const parts = encryptSecretParts('segredo')
    const tampered = { ...parts, tag: Buffer.alloc(16, 7).toString('base64') }
    expect(() => decryptSecretParts(tampered)).toThrow(/decrypt failed/)
  })

  it('nonce com tamanho inválido → throws', () => {
    const parts = encryptSecretParts('segredo')
    expect(() => decryptSecretParts({ ...parts, nonce: 'AAAA' })).toThrow(/nonce length/)
  })

  it('chave errada → throws decrypt failed', () => {
    const parts = encryptSecretParts('teste')
    const savedKey = process.env.LOGIFIT_DATA_KEY
    process.env.LOGIFIT_DATA_KEY = generateMasterKey()
    expect(() => decryptSecretParts(parts)).toThrow(/decrypt failed/)
    process.env.LOGIFIT_DATA_KEY = savedKey
  })
})

afterEach(() => {
  // sem cleanup específico — key se mantém pelo describe
})
