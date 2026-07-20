import { describe, expect, it } from 'vitest'
import { addressSchema, isAddressFiscallyComplete, normalizeAddress } from './address'

describe('addressSchema', () => {
  it('aceita endereço parcial — cadastro em andamento é legítimo', () => {
    expect(addressSchema.safeParse({ cidade: 'Cascavel', uf: 'PR' }).success).toBe(true)
    expect(addressSchema.safeParse({}).success).toBe(true)
  })

  it('aceita null nos campos — providers externos devolvem null pra ausente', () => {
    expect(addressSchema.safeParse({ cep: null, logradouro: null }).success).toBe(true)
  })

  it('rejeita UF fora de 2 letras', () => {
    expect(addressSchema.safeParse({ uf: 'PRR' }).success).toBe(false)
    expect(addressSchema.safeParse({ uf: 'P' }).success).toBe(false)
  })
})

describe('normalizeAddress', () => {
  it('endereço só com campos vazios vira null, não objeto vazio', () => {
    // Distinguir "não informado" de "informado vazio" é o que permite a UI
    // avisar que o cadastro fiscal está incompleto.
    expect(normalizeAddress({ cep: '', logradouro: '   ' })).toBeNull()
    expect(normalizeAddress({})).toBeNull()
    expect(normalizeAddress(null)).toBeNull()
    expect(normalizeAddress(undefined)).toBeNull()
  })

  it('remove só os campos vazios, preserva os preenchidos', () => {
    expect(normalizeAddress({ cidade: 'Cascavel', uf: 'PR', complemento: '' })).toEqual({
      cidade: 'Cascavel',
      uf: 'PR',
    })
  })

  it('descarta null de provider externo sem perder o resto', () => {
    expect(normalizeAddress({ cep: null, cidade: 'Cascavel', uf: 'PR' })).toEqual({
      cidade: 'Cascavel',
      uf: 'PR',
    })
  })

  it('faz trim dos valores', () => {
    expect(normalizeAddress({ cidade: '  Cascavel  ' })).toEqual({ cidade: 'Cascavel' })
  })
})

describe('isAddressFiscallyComplete', () => {
  it('endereço da ESP (Cascavel/PR) passa', () => {
    expect(
      isAddressFiscallyComplete({
        cep: '85807570',
        logradouro: 'RUA ANTONIO JOSE ELIAS',
        numero: '524',
        bairro: 'COQUEIRAL',
        cidade: 'Cascavel',
        uf: 'PR',
      }),
    ).toBe(true)
  })

  it('só cidade e UF não basta — é o shape que units tinha no seed', () => {
    expect(isAddressFiscallyComplete({ cidade: 'São Paulo', uf: 'SP' })).toBe(false)
  })

  it('sem número não passa — layout fiscal exige', () => {
    expect(isAddressFiscallyComplete({ logradouro: 'Rua X', cidade: 'Cascavel', uf: 'PR' })).toBe(
      false,
    )
  })

  it('null/undefined não passa', () => {
    expect(isAddressFiscallyComplete(null)).toBe(false)
    expect(isAddressFiscallyComplete(undefined)).toBe(false)
  })
})
