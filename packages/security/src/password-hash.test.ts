/**
 * password-hash — unit tests (Sprint 02b3).
 *
 * Smoke tests scrypt + verify + format + needsRehash + edge cases.
 */
import { describe, expect, it } from 'vitest'
import { hashPassword, needsRehash, verifyPassword } from './password-hash'

describe('password-hash', () => {
  describe('hashPassword', () => {
    it('hash format `scrypt$N$r$p$salt$hash` (6 partes)', async () => {
      const hash = await hashPassword('senha-do-paciente')
      expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
      const parts = hash.split('$')
      expect(parts).toHaveLength(6)
      expect(parts[0]).toBe('scrypt')
    })

    it('hashes diferentes pra mesma senha (salt random)', async () => {
      const a = await hashPassword('mesma-senha')
      const b = await hashPassword('mesma-senha')
      expect(a).not.toBe(b)
    })

    it('hash não contém senha plain', async () => {
      const plain = 'meu-segredo-super-revelador-XYZ'
      const hash = await hashPassword(plain)
      expect(hash).not.toContain(plain)
    })

    it('lança em senha vazia', async () => {
      await expect(hashPassword('')).rejects.toThrow()
    })
  })

  describe('verifyPassword', () => {
    it('round-trip básico: hash → verify true', async () => {
      const hash = await hashPassword('correto')
      expect(await verifyPassword('correto', hash)).toBe(true)
    })

    it('senha errada retorna false', async () => {
      const hash = await hashPassword('correto')
      expect(await verifyPassword('errado', hash)).toBe(false)
    })

    it('case-sensitive', async () => {
      const hash = await hashPassword('Senha')
      expect(await verifyPassword('senha', hash)).toBe(false)
      expect(await verifyPassword('SENHA', hash)).toBe(false)
      expect(await verifyPassword('Senha', hash)).toBe(true)
    })

    it('whitespace-sensitive', async () => {
      const hash = await hashPassword('senha')
      expect(await verifyPassword(' senha', hash)).toBe(false)
      expect(await verifyPassword('senha ', hash)).toBe(false)
      expect(await verifyPassword('senha', hash)).toBe(true)
    })

    it('hash mal-formatado retorna false silencioso (fail-closed)', async () => {
      expect(await verifyPassword('x', 'invalid-format')).toBe(false)
      expect(await verifyPassword('x', 'scrypt$wrong$format')).toBe(false)
      expect(await verifyPassword('x', '')).toBe(false)
      expect(await verifyPassword('x', 'bcrypt$2a$10$...')).toBe(false)
    })

    it('inputs não-string retorna false', async () => {
      // @ts-expect-error testando guard em runtime
      expect(await verifyPassword(null, 'hash')).toBe(false)
      // @ts-expect-error
      expect(await verifyPassword('plain', undefined)).toBe(false)
    })

    it('senhas longas (>128 chars) funcionam', async () => {
      const long = 'a'.repeat(200)
      const hash = await hashPassword(long)
      expect(await verifyPassword(long, hash)).toBe(true)
      expect(await verifyPassword(`${long}x`, hash)).toBe(false)
    })

    it('caracteres unicode preservados', async () => {
      const plain = 'sénha-açaí-🔑'
      const hash = await hashPassword(plain)
      expect(await verifyPassword(plain, hash)).toBe(true)
      expect(await verifyPassword('senha-acai', hash)).toBe(false)
    })
  })

  describe('needsRehash', () => {
    it('hash com N atual NÃO precisa rehash', async () => {
      const hash = await hashPassword('senha')
      expect(needsRehash(hash)).toBe(false)
    })

    it('hash mal-formatado precisa rehash (fail-safe)', () => {
      expect(needsRehash('invalid')).toBe(true)
      expect(needsRehash('')).toBe(true)
      expect(needsRehash('bcrypt$2a$10$...')).toBe(true)
    })

    it('hash com N muito baixo precisa rehash', () => {
      // Simula hash legado com N=1024 (~16x mais fraco que atual 16384)
      const legacyHash = 'scrypt$1024$8$1$AAAA$BBBB'
      expect(needsRehash(legacyHash)).toBe(true)
    })
  })
})
