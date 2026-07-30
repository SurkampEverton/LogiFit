import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { isSecretPem, secretPem } from './secret-pem'

/**
 * DoD do Sprint 41: "chave privada não aparece em log, GlitchTip nem retorno de
 * Server Action — teste que prova". Estes são esse teste.
 *
 * Cada caso reproduz um caminho real de vazamento acidental: o logger
 * estruturado (`pino` serializa com JSON), o `console.log` de debug (usa
 * `util.inspect`), a interpolação em mensagem de erro, e o envelope de resposta
 * da Server Action (ADR 0071, também JSON).
 */
const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIsegredoDeVerdade\n-----END RSA PRIVATE KEY-----'

describe('secretPem', () => {
  const secret = secretPem(PEM)

  it('devolve o PEM só por chamada explícita', () => {
    expect(secret.reveal()).toBe(PEM)
  })

  it('não vaza em JSON.stringify — o caminho do pino e do envelope de ação', () => {
    const serialized = JSON.stringify({ cert: { privateKey: secret, cnpj: '123' } })
    expect(serialized).not.toContain('segredoDeVerdade')
    expect(serialized).toContain('REDACTED')
  })

  it('não vaza em util.inspect — o caminho do console.log', () => {
    expect(inspect({ privateKey: secret }, { depth: 5 })).not.toContain('segredoDeVerdade')
  })

  it('não vaza em interpolação de string — o caminho da mensagem de erro', () => {
    expect(`chave: ${secret}`).not.toContain('segredoDeVerdade')
    expect(String(secret)).toBe('[REDACTED:private-key]')
  })

  // Se o PEM fosse propriedade do objeto, um serializador que percorre chaves
  // (Sentry/GlitchTip faz isso) o encontraria mesmo com toJSON definido.
  it('não expõe o PEM como propriedade enumerável', () => {
    expect(Object.values(secret)).not.toContain(PEM)
    expect(JSON.stringify(Object.getOwnPropertyNames(secret))).not.toContain('segredoDeVerdade')
  })

  it('sobrevive a aninhamento profundo', () => {
    const deep = { a: { b: { c: [{ d: secret }] } } }
    expect(JSON.stringify(deep)).not.toContain('segredoDeVerdade')
  })
})

describe('isSecretPem', () => {
  it('distingue de string crua esquecida', () => {
    expect(isSecretPem(secretPem(PEM))).toBe(true)
    expect(isSecretPem(PEM)).toBe(false)
    expect(isSecretPem(null)).toBe(false)
    expect(isSecretPem({ reveal: 'não é função' })).toBe(false)
  })
})
