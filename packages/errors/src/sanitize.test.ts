import { describe, expect, it } from 'vitest'
import { maskCnpj, maskCpf, maskEmail, maskPhone, sanitize, sanitizeString } from './sanitize'

describe('maskCpf', () => {
  it('mascara CPF formatado', () => {
    expect(maskCpf('123.456.789-09')).toBe('123.***.***-09')
  })

  it('mascara CPF só dígitos', () => {
    expect(maskCpf('12345678909')).toBe('123.***.***-09')
  })

  it('preserva texto ao redor', () => {
    expect(maskCpf('CPF do paciente: 123.456.789-09 (ok)')).toBe(
      'CPF do paciente: 123.***.***-09 (ok)',
    )
  })

  it('não toca em outras strings', () => {
    expect(maskCpf('sem cpf aqui')).toBe('sem cpf aqui')
  })
})

describe('maskCnpj', () => {
  it('mascara CNPJ formatado', () => {
    expect(maskCnpj('33.009.911/0041-26')).toBe('33.***.***/****-26')
  })

  it('mascara CNPJ só dígitos', () => {
    expect(maskCnpj('33009911004126')).toBe('33.***.***/****-26')
  })
})

describe('maskEmail', () => {
  it('mascara local-part preservando 1 char + domínio', () => {
    expect(maskEmail('joao.silva@example.com')).toBe('j***@example.com')
  })

  it('preserva subdomínios', () => {
    expect(maskEmail('user@mail.logifit.com.br')).toBe('u***@mail.logifit.com.br')
  })
})

describe('maskPhone', () => {
  it('mascara celular BR com DDD sem prefix +', () => {
    expect(maskPhone('55 (11) 98765-4321')).toBe('+55 (11) ****-4321')
  })

  it('mascara variantes com 5511 prefix', () => {
    expect(maskPhone('5511987654321')).toContain('****')
  })
})

describe('sanitizeString', () => {
  it('combina todos os masks', () => {
    const raw = 'CPF 123.456.789-09 email joao@x.com tel +55 11 98765-4321'
    const masked = sanitizeString(raw)
    expect(masked).toContain('123.***')
    expect(masked).toContain('j***@x.com')
    expect(masked).toContain('****')
  })
})

describe('sanitize (recursivo)', () => {
  it('null/undefined passam', () => {
    expect(sanitize(null)).toBeNull()
    expect(sanitize(undefined)).toBeUndefined()
  })

  it('primitivos non-string passam intactos', () => {
    expect(sanitize(42)).toBe(42)
    expect(sanitize(true)).toBe(true)
  })

  it('string aplica sanitizeString', () => {
    expect(sanitize('CPF 123.456.789-09')).toContain('***')
  })

  it('arrays sanitizam cada item', () => {
    expect(sanitize(['joao@x.com', 'maria@y.com'])).toEqual(['j***@x.com', 'm***@y.com'])
  })

  it('chave password redact total', () => {
    expect(sanitize({ password: 'secret123' })).toEqual({ password: '[REDACTED]' })
  })

  it('chave senha (pt) redact total', () => {
    expect(sanitize({ senha: 'minha-senha' })).toEqual({ senha: '[REDACTED]' })
  })

  it('chave token redact total', () => {
    expect(sanitize({ token: 'abc.def.ghi' })).toEqual({ token: '[REDACTED]' })
  })

  it('chaves clínicas redact (LGPD art. 11)', () => {
    expect(sanitize({ diagnostico: 'F32.0', cid10: 'F32' })).toEqual({
      diagnostico: '[REDACTED]',
      cid10: '[REDACTED]',
    })
  })

  it('case-insensitive na chave', () => {
    expect(sanitize({ PASSWORD: 'x' })).toEqual({ PASSWORD: '[REDACTED]' })
    expect(sanitize({ Token: 'x' })).toEqual({ Token: '[REDACTED]' })
  })

  it('recurse em objeto aninhado', () => {
    const input = {
      user: { email: 'a@b.com', password: 'secret' },
      tenant: { name: 'X' },
    }
    expect(sanitize(input)).toEqual({
      user: { email: 'a***@b.com', password: '[REDACTED]' },
      tenant: { name: 'X' },
    })
  })

  it('preserva keys não-sensíveis', () => {
    expect(sanitize({ id: 'abc', name: 'João' })).toEqual({ id: 'abc', name: 'João' })
  })
})

describe('sanitize — chaves compostas', () => {
  // O match exato deixava passar nomes compostos reais: a senha do portal
  // municipal (`senha_responsavel`, Focus NFe) vazaria em claro no audit_log.
  it('redige chave composta em snake_case', () => {
    expect(sanitize({ senha_responsavel: 'hunter2' })).toEqual({
      senha_responsavel: '[REDACTED]',
    })
    expect(sanitize({ client_secret: 'x' })).toEqual({ client_secret: '[REDACTED]' })
  })

  it('redige chave composta em camelCase', () => {
    expect(sanitize({ senhaPortal: 'x' })).toEqual({ senhaPortal: '[REDACTED]' })
    expect(sanitize({ userPassword: 'x' })).toEqual({ userPassword: '[REDACTED]' })
    expect(sanitize({ focusApiToken: 'x' })).toEqual({ focusApiToken: '[REDACTED]' })
  })

  it('não redige demais — segmento, não substring', () => {
    // 'secretary' contém 'secret' mas é um segmento só; 'tokenizer' idem.
    expect(sanitize({ secretary: 'Ana', tokenizer: 'bpe' })).toEqual({
      secretary: 'Ana',
      tokenizer: 'bpe',
    })
  })

  it('redige dentro de objeto aninhado com chave composta', () => {
    expect(sanitize({ focus: { login_responsavel: 'joao', senha_responsavel: 'x' } })).toEqual({
      focus: { login_responsavel: 'joao', senha_responsavel: '[REDACTED]' },
    })
  })
})
