/**
 * Logger estruturado base (pino) — boundaries de Server Action / API Route / Job
 * (ADR 0071 + regra 33).
 *
 * Por que pino: JSON pra stdout direto, sem deps de transport. Promtail captura
 * logs Docker e empurra pro Loki self-host (ADR 0091). Adiciona timestamp ISO,
 * level numérico (50=error), pid/hostname automaticamente.
 *
 * Padrão de uso: wrappers (wrap-action, wrap-api-handler, wrap-job) usam
 * internamente. Sprint dono normalmente não invoca direto.
 *
 * Sanitização: caller é responsável por passar payload já sanitizado (use
 * sanitize() antes de logar dado de usuário). Pino tem redact option;
 * adicionamos os campos canônicos LGPD (cpf, cnpj, email, senha, token) como
 * defesa adicional.
 */
import pino from 'pino'
import type { Logger } from 'pino'

const REDACT_PATHS = [
  '*.cpf',
  '*.cnpj',
  '*.password',
  '*.senha',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.api_key',
  '*.email',
  '*.secret',
  '*.private_key',
  'cpf',
  'cnpj',
  'password',
  'senha',
  'token',
  'email',
  'secret',
]

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // base fields automáticos em toda linha — Promtail/Loki indexa
  base: {
    service: process.env.LF_SERVICE ?? 'logifit-web',
    env: process.env.NODE_ENV ?? 'development',
  },
  // timestamp ISO em vez de epoch ms (mais legível em Grafana)
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  // pino default já produz JSON; transport pretty só em dev opcional
  transport:
    process.env.NODE_ENV === 'development' && process.env.LF_PINO_PRETTY === '1'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        }
      : undefined,
})

/**
 * Helper de log de boundary. Adiciona request_id e module automaticamente
 * e produz linha consistente. Usado por wrap-action, wrap-api-handler,
 * wrap-job.
 */
export interface BoundaryLogPayload {
  request_id: string
  module: string
  code?: string
  fingerprint?: string
  message?: string
  /** Latência ms da operação (boundary mede). */
  duration_ms?: number
  /** Detalhes extras já sanitizados pelo caller. */
  [key: string]: unknown
}

export function logBoundaryInfo(payload: BoundaryLogPayload): void {
  logger.info(payload)
}

export function logBoundaryError(payload: BoundaryLogPayload): void {
  logger.error(payload)
}

export function logBoundaryWarn(payload: BoundaryLogPayload): void {
  logger.warn(payload)
}
