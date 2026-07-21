/**
 * Testes de PII redaction — Sprint 06 Faixa B.
 *
 * Cobertura: CPF, CNPJ, RG, email, telefone, cartão, PIX, CEP.
 * Verifica máscara parcial preservando dígitos úteis (verificador CPF/CNPJ).
 */
import { describe, expect, it } from 'vitest'
import { redactBeforeLLM, redactRagChunks } from './redact'

describe('redactBeforeLLM', () => {
  it('mascara CPF preservando últimos 2 dígitos', () => {
    const { redacted, hits } = redactBeforeLLM('CPF do João é 123.456.789-00')
    expect(redacted).toBe('CPF do João é ***.***.***-00')
    expect(hits.cpf).toBe(1)
  })

  it('mascara CPF sem formatação', () => {
    const { redacted } = redactBeforeLLM('cpf 12345678900')
    expect(redacted).toBe('cpf ***.***.***-00')
  })

  it('mascara CNPJ preservando filial + verificador', () => {
    const { redacted, hits } = redactBeforeLLM('CNPJ 12.345.678/0001-90')
    expect(redacted).toBe('CNPJ **.***.***/0001-90')
    expect(hits.cnpj).toBe(1)
  })

  it('mascara email mantendo domínio', () => {
    const { redacted, hits } = redactBeforeLLM('user@logifit.com.br pediu suporte')
    expect(redacted).toBe('***@logifit.com.br pediu suporte')
    expect(hits.email).toBe(1)
  })

  it('mascara telefone BR mantendo DDD', () => {
    const { redacted, hits } = redactBeforeLLM('Liguei para (11) 99999-8888')
    expect(redacted).toBe('Liguei para (11) ****-****')
    expect(hits.phone).toBe(1)
  })

  it('mascara cartão preservando últimos 4', () => {
    const { redacted, hits } = redactBeforeLLM('cartão 4111-2222-3333-4444 falhou')
    expect(redacted).toBe('cartão **** **** **** 4444 falhou')
    expect(hits.credit_card).toBe(1)
  })

  it('mascara PIX UUID aleatória', () => {
    const { redacted, hits } = redactBeforeLLM('chave PIX a1b2c3d4-1234-4abc-89de-1234567890ab')
    expect(redacted).toBe('chave PIX [PIX_KEY]')
    expect(hits.pix_random).toBe(1)
  })

  it('mascara CEP mantendo região', () => {
    const { redacted, hits } = redactBeforeLLM('CEP 01310-100, São Paulo')
    expect(redacted).toBe('CEP 01310-***, São Paulo')
    expect(hits.cep).toBe(1)
  })

  it('combina múltiplos padrões na mesma string', () => {
    const text = 'João (CPF 123.456.789-00) liga para (11) 98765-4321 ou joao@x.com'
    const { redacted, hits } = redactBeforeLLM(text)
    expect(redacted).toContain('***.***.***-00')
    expect(redacted).toContain('(11) ****-****')
    expect(redacted).toContain('***@x.com')
    expect(hits.cpf).toBe(1)
    expect(hits.phone).toBe(1)
    expect(hits.email).toBe(1)
  })

  it('retorna string vazia quando input vazio', () => {
    expect(redactBeforeLLM('')).toEqual({ redacted: '', hits: {} })
  })

  it('preserva texto sem PII', () => {
    const { redacted, hits } = redactBeforeLLM('Olá, como funciona o assistente?')
    expect(redacted).toBe('Olá, como funciona o assistente?')
    expect(Object.keys(hits)).toHaveLength(0)
  })
})

describe('redactRagChunks', () => {
  it('mascara content preservando metadata', () => {
    const chunks = [
      { source: 'adr-0064.md', title: 'IA Arch', content: 'CPF do exemplo: 123.456.789-00' },
      { source: 'sprint-06.md', title: 'Sprint 06', content: 'Sem PII aqui' },
    ]
    const out = redactRagChunks(chunks)
    expect(out[0]?.content).toBe('CPF do exemplo: ***.***.***-00')
    expect(out[0]?.title).toBe('IA Arch')
    expect(out[1]?.content).toBe('Sem PII aqui')
  })
})
