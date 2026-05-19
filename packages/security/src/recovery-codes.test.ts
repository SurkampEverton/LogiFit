/**
 * recovery-codes — unit tests (Sprint 02b3).
 *
 * Cobertura: generate + hash + verify + findUnused + markUsed + count.
 */
import { describe, expect, it } from 'vitest'
import {
  countAvailableRecoveryCodes,
  findUnusedMatchingCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  markRecoveryCodeUsed,
  type RecoveryCodeEntry,
  verifyRecoveryCode,
} from './recovery-codes'

describe('recovery-codes', () => {
  describe('generateRecoveryCodes', () => {
    it('default gera 10 codes', () => {
      const codes = generateRecoveryCodes()
      expect(codes).toHaveLength(10)
    })

    it('formato XXXX-XXXX-XXXX (12 chars + 2 hifens = 14)', () => {
      const codes = generateRecoveryCodes(5)
      for (const c of codes) {
        expect(c).toHaveLength(14)
        expect(c).toMatch(/^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/)
      }
    })

    it('alfabeto Crockford reduzido (sem I/L/O/U)', () => {
      const codes = generateRecoveryCodes(20)
      const joined = codes.join('')
      expect(joined).not.toMatch(/[ILOU01]/)
    })

    it('códigos únicos no batch', () => {
      const codes = generateRecoveryCodes(20)
      const unique = new Set(codes)
      expect(unique.size).toBe(20)
    })

    it('aceita n=1 e n=50', () => {
      expect(generateRecoveryCodes(1)).toHaveLength(1)
      expect(generateRecoveryCodes(50)).toHaveLength(50)
    })

    it('rejeita n inválido', () => {
      expect(() => generateRecoveryCodes(0)).toThrow()
      expect(() => generateRecoveryCodes(51)).toThrow()
      expect(() => generateRecoveryCodes(-1)).toThrow()
      expect(() => generateRecoveryCodes(1.5)).toThrow()
    })
  })

  describe('hashRecoveryCode / verifyRecoveryCode', () => {
    it('hash determinístico — mesmo code gera mesmo hash', () => {
      const hash1 = hashRecoveryCode('ABCD-EFGH-JKMN')
      const hash2 = hashRecoveryCode('ABCD-EFGH-JKMN')
      expect(hash1).toBe(hash2)
    })

    it('hash é SHA-256 hex (64 chars)', () => {
      const hash = hashRecoveryCode('ABCD-EFGH-JKMN')
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('normalização: case-insensitive', () => {
      const upper = hashRecoveryCode('ABCD-EFGH-JKMN')
      const lower = hashRecoveryCode('abcd-efgh-jkmn')
      const mixed = hashRecoveryCode('AbCd-EfGh-JkMn')
      expect(upper).toBe(lower)
      expect(upper).toBe(mixed)
    })

    it('normalização: ignora hifens', () => {
      const withDashes = hashRecoveryCode('ABCD-EFGH-JKMN')
      const noDashes = hashRecoveryCode('ABCDEFGHJKMN')
      expect(withDashes).toBe(noDashes)
    })

    it('round-trip: hash → verify true', () => {
      const plain = 'ABCD-EFGH-JKMN'
      const hash = hashRecoveryCode(plain)
      expect(verifyRecoveryCode(plain, hash)).toBe(true)
    })

    it('verify case/dash-insensitive', () => {
      const hash = hashRecoveryCode('ABCD-EFGH-JKMN')
      expect(verifyRecoveryCode('abcd-efgh-jkmn', hash)).toBe(true)
      expect(verifyRecoveryCode('ABCDEFGHJKMN', hash)).toBe(true)
    })

    it('code errado retorna false', () => {
      const hash = hashRecoveryCode('ABCD-EFGH-JKMN')
      expect(verifyRecoveryCode('WXYZ-1234-5678', hash)).toBe(false)
    })

    it('inputs não-string retornam false (fail-closed)', () => {
      // @ts-expect-error testando guard runtime
      expect(verifyRecoveryCode(null, 'hash')).toBe(false)
      // @ts-expect-error
      expect(verifyRecoveryCode('plain', undefined)).toBe(false)
    })
  })

  describe('findUnusedMatchingCode', () => {
    function buildEntries(plain: string[], usedIndexes: number[] = []): RecoveryCodeEntry[] {
      return plain.map((p, i) => ({
        hash: hashRecoveryCode(p),
        used_at: usedIndexes.includes(i) ? new Date().toISOString() : null,
      }))
    }

    it('encontra code disponível matchando', () => {
      const codes = ['AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB', 'CCCC-CCCC-CCCC']
      const entries = buildEntries(codes)
      expect(findUnusedMatchingCode('BBBB-BBBB-BBBB', entries)).toBe(1)
    })

    it('ignora codes usados mesmo se matchar', () => {
      const codes = ['AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB']
      const entries = buildEntries(codes, [1]) // BBBB marcado como usado
      expect(findUnusedMatchingCode('BBBB-BBBB-BBBB', entries)).toBe(-1)
    })

    it('encontra primeiro disponível se duplicate impossível (normalmente unique)', () => {
      const codes = ['AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB']
      const entries = buildEntries(codes)
      expect(findUnusedMatchingCode('AAAA-AAAA-AAAA', entries)).toBe(0)
    })

    it('retorna -1 quando code não está no array', () => {
      const entries = buildEntries(['AAAA-AAAA-AAAA'])
      expect(findUnusedMatchingCode('ZZZZ-ZZZZ-ZZZZ', entries)).toBe(-1)
    })

    it('retorna -1 em array vazio', () => {
      expect(findUnusedMatchingCode('AAAA-AAAA-AAAA', [])).toBe(-1)
    })

    it('aceita normalizações (lowercase + sem dash)', () => {
      const entries = buildEntries(['ABCD-EFGH-JKMN'])
      expect(findUnusedMatchingCode('abcdefghjkmn', entries)).toBe(0)
    })
  })

  describe('markRecoveryCodeUsed', () => {
    it('marca index N como usado, preserva outros', () => {
      const codes: RecoveryCodeEntry[] = [
        { hash: 'h1', used_at: null },
        { hash: 'h2', used_at: null },
        { hash: 'h3', used_at: null },
      ]
      const updated = markRecoveryCodeUsed(codes, 1)
      expect(updated[0]!.used_at).toBeNull()
      expect(updated[1]!.used_at).not.toBeNull()
      expect(updated[2]!.used_at).toBeNull()
      // Original não mutado
      expect(codes[1]!.used_at).toBeNull()
    })

    it('lança em index inválido', () => {
      const codes: RecoveryCodeEntry[] = [{ hash: 'h1', used_at: null }]
      expect(() => markRecoveryCodeUsed(codes, -1)).toThrow()
      expect(() => markRecoveryCodeUsed(codes, 1)).toThrow()
      expect(() => markRecoveryCodeUsed(codes, 5)).toThrow()
    })

    it('marked timestamp em formato ISO', () => {
      const codes: RecoveryCodeEntry[] = [{ hash: 'h', used_at: null }]
      const updated = markRecoveryCodeUsed(codes, 0)
      expect(updated[0]!.used_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })

  describe('countAvailableRecoveryCodes', () => {
    it('conta apenas codes não-usados', () => {
      const codes: RecoveryCodeEntry[] = [
        { hash: 'h1', used_at: null },
        { hash: 'h2', used_at: '2026-01-01T00:00:00Z' },
        { hash: 'h3', used_at: null },
      ]
      expect(countAvailableRecoveryCodes(codes)).toBe(2)
    })

    it('retorna 0 quando todos usados', () => {
      const codes: RecoveryCodeEntry[] = [
        { hash: 'h1', used_at: '2026-01-01T00:00:00Z' },
        { hash: 'h2', used_at: '2026-01-02T00:00:00Z' },
      ]
      expect(countAvailableRecoveryCodes(codes)).toBe(0)
    })

    it('retorna 0 em array vazio', () => {
      expect(countAvailableRecoveryCodes([])).toBe(0)
    })
  })
})
