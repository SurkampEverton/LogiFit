/**
 * `SecretPem` — chave privada que **não vaza em log** por construção.
 *
 * O DoD do Sprint 41 exige que a chave privada do certificado A1 nunca apareça
 * em log, GlitchTip ou retorno de Server Action. Depender de disciplina ("não
 * logue isso") falha na primeira vez que alguém faz `logger.info({ cert })` ou
 * que o Sentry serializa o contexto de uma exceção.
 *
 * Aqui a proteção é estrutural: `toString`, `toJSON` e o inspetor do Node
 * devolvem `[REDACTED]`. Para chegar ao PEM de verdade é preciso chamar
 * `reveal()` — que é grep-ável em code review e no lint.
 *
 * Não protege contra um atacante com execução de código no servidor; protege
 * contra o acidente, que é o risco real e frequente.
 */

const REDACTED = '[REDACTED:private-key]'

/** Símbolo do inspetor do Node — `console.log` e o pino honram. */
const NODE_INSPECT = Symbol.for('nodejs.util.inspect.custom')

export interface SecretPem {
  /** Devolve o PEM em claro. Chamada deliberada e auditável. */
  reveal(): string
  toString(): string
  toJSON(): string
  readonly [NODE_INSPECT]: () => string
}

/**
 * Embrulha um PEM sensível. O valor fica em closure — não há propriedade
 * enumerável para um serializador genérico encontrar.
 */
export function secretPem(pem: string): SecretPem {
  const redact = () => REDACTED
  return {
    reveal: () => pem,
    toString: redact,
    toJSON: redact,
    [NODE_INSPECT]: redact,
  }
}

/** `true` se o valor é um `SecretPem` (e não uma string crua esquecida). */
export function isSecretPem(value: unknown): value is SecretPem {
  return (
    typeof value === 'object' && value !== null && typeof (value as SecretPem).reveal === 'function'
  )
}
