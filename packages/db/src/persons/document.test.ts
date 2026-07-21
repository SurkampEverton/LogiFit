import { describe, expect, it } from 'vitest'
import {
  detectKind,
  formatDocument,
  isValidCnpj,
  isValidCpf,
  normalizeDocument,
  parseDocument,
} from './document'

describe('normalizeDocument', () => {
  it('remove pontos e traços do CPF formatado', () => {
    expect(normalizeDocument('123.456.789-09')).toBe('12345678909')
  })

  it('remove pontos, barras e traços do CNPJ formatado', () => {
    expect(normalizeDocument('12.345.678/0001-95')).toBe('12345678000195')
  })

  it('aceita input com espaços e caracteres lixo', () => {
    expect(normalizeDocument(' 123. 456. 789 09  ')).toBe('12345678909')
  })

  it('trata input vazio sem crashar', () => {
    expect(normalizeDocument('')).toBe('')
  })

  it('trata input null/undefined sem crashar', () => {
    expect(normalizeDocument(null as unknown as string)).toBe('')
    expect(normalizeDocument(undefined as unknown as string)).toBe('')
  })
})

describe('detectKind', () => {
  it('11 dígitos = pf', () => {
    expect(detectKind('12345678909')).toBe('pf')
  })

  it('14 dígitos = pj', () => {
    expect(detectKind('12345678000195')).toBe('pj')
  })

  it('demais comprimentos = null', () => {
    expect(detectKind('123')).toBeNull()
    expect(detectKind('123456789')).toBeNull()
    expect(detectKind('123456789012345')).toBeNull()
    expect(detectKind('')).toBeNull()
  })
})

describe('isValidCpf', () => {
  // CPFs válidos canônicos (gerados por algoritmo, não dados reais)
  it.each(['11144477735', '52998224725', '12345678909', '00000000191', '93541134780'])(
    'aceita CPF válido %s',
    (cpf) => {
      expect(isValidCpf(cpf)).toBe(true)
    },
  )

  it('rejeita CPF com dígito verificador inválido', () => {
    expect(isValidCpf('11144477734')).toBe(false) // último dígito errado
    expect(isValidCpf('12345678900')).toBe(false)
  })

  it('rejeita CPFs com todos dígitos iguais (caso especial)', () => {
    expect(isValidCpf('00000000000')).toBe(false)
    expect(isValidCpf('11111111111')).toBe(false)
    expect(isValidCpf('99999999999')).toBe(false)
  })

  it('rejeita strings com tamanho errado', () => {
    expect(isValidCpf('123')).toBe(false)
    expect(isValidCpf('1234567890')).toBe(false)
    expect(isValidCpf('123456789012')).toBe(false)
  })
})

describe('isValidCnpj', () => {
  it.each([
    '11222333000181',
    '12345678000195',
    '00000000000191',
    '34028316000103', // Correios (público)
    '60746948000112', // Bradesco matriz (público)
  ])('aceita CNPJ válido %s', (cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(true)
  })

  it('rejeita CNPJ com dígito verificador inválido', () => {
    expect(isValidCnpj('11222333000180')).toBe(false)
    expect(isValidCnpj('12345678000100')).toBe(false)
  })

  it('rejeita CNPJs com todos dígitos iguais', () => {
    expect(isValidCnpj('00000000000000')).toBe(false)
    expect(isValidCnpj('11111111111111')).toBe(false)
  })

  it('rejeita strings com tamanho errado', () => {
    expect(isValidCnpj('123')).toBe(false)
    expect(isValidCnpj('12345678901')).toBe(false)
    expect(isValidCnpj('123456789012345')).toBe(false)
  })
})

describe('parseDocument (boundary canônica)', () => {
  it('CPF formatado válido → ok pf', () => {
    expect(parseDocument('111.444.777-35')).toEqual({
      ok: true,
      kind: 'pf',
      normalized: '11144477735',
    })
  })

  it('CNPJ formatado válido → ok pj', () => {
    expect(parseDocument('11.222.333/0001-81')).toEqual({
      ok: true,
      kind: 'pj',
      normalized: '11222333000181',
    })
  })

  it('CPF sem formatação → ok pf', () => {
    expect(parseDocument('11144477735')).toEqual({
      ok: true,
      kind: 'pf',
      normalized: '11144477735',
    })
  })

  it('empty → reason empty', () => {
    expect(parseDocument('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseDocument('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('comprimento errado → reason invalid_length', () => {
    expect(parseDocument('123')).toEqual({ ok: false, reason: 'invalid_length' })
    expect(parseDocument('12345678901234567')).toEqual({
      ok: false,
      reason: 'invalid_length',
    })
  })

  it('todos dígitos iguais → reason all_same_digit', () => {
    expect(parseDocument('111.111.111-11')).toEqual({
      ok: false,
      reason: 'all_same_digit',
    })
    expect(parseDocument('00000000000000')).toEqual({
      ok: false,
      reason: 'all_same_digit',
    })
  })

  it('dígito verificador errado → reason check_digit_mismatch', () => {
    expect(parseDocument('123.456.789-00')).toEqual({
      ok: false,
      reason: 'check_digit_mismatch',
    })
    expect(parseDocument('11.222.333/0001-99')).toEqual({
      ok: false,
      reason: 'check_digit_mismatch',
    })
  })
})

describe('formatDocument', () => {
  it('formata CPF normalizado', () => {
    expect(formatDocument('11144477735')).toBe('111.444.777-35')
  })

  it('formata CNPJ normalizado', () => {
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81')
  })

  it('retorna input cru se tamanho não bate (não tenta formatar parcial)', () => {
    expect(formatDocument('123')).toBe('123')
    expect(formatDocument('')).toBe('')
  })
})
