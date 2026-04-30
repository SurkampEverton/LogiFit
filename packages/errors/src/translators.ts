/**
 * Translators — convertem erros de provedores externos / libs em ApiError
 * canônico. Cada sprint que adiciona dependência popula seu translator real.
 *
 * Sprint 00: 10 stubs por provedor + Zod + fallback genérico (sempre matches).
 * Sprints donos (04 Asaas, 13 Twilio, 17 Pluggy, 22 TISS, 36 Focus, etc) refinam.
 */
import type { ApiError } from './api-error'
import { sanitize } from './sanitize'

export interface ErrorTranslator {
  matches(error: unknown): boolean
  translate(
    error: unknown,
    ctx: { request_id: string; module: string; tenantId?: string },
  ): Omit<ApiError, 'request_id' | 'fingerprint'>
}

function isErrorWithName(e: unknown, name: string): boolean {
  return e instanceof Error && e.name === name
}

function hasErrorMessage(e: unknown, pattern: RegExp): boolean {
  return e instanceof Error && pattern.test(e.message)
}

function getMessage(e: unknown, fallback?: string): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return fallback ?? 'Unknown error'
}

function extractZodIssues(e: unknown): Record<string, unknown> {
  if (
    e instanceof Error &&
    'issues' in e &&
    Array.isArray((e as { issues: unknown[] }).issues)
  ) {
    return { issues: (e as { issues: unknown[] }).issues }
  }
  return {}
}

export const zodTranslator: ErrorTranslator = {
  matches: (e) => isErrorWithName(e, 'ZodError'),
  translate: (e) => ({
    code: 'VALIDATION_ERROR',
    message: 'Dados inválidos',
    details: sanitize(extractZodIssues(e)),
  }),
}

export const asaasTranslator: ErrorTranslator = {
  matches: (e) => isErrorWithName(e, 'AsaasError'),
  translate: (e) => ({
    code: 'PAYMENT_FAILED',
    message: getMessage(e, 'Falha no provedor de pagamento'),
    details: sanitize({ provider: 'asaas', raw: getMessage(e) }),
  }),
}

export const focusNfeTranslator: ErrorTranslator = {
  matches: (e) => isErrorWithName(e, 'FocusNfeError'),
  translate: (e) => ({
    code: 'FISCAL_REJECTED',
    message: getMessage(e, 'Documento fiscal rejeitado'),
    details: sanitize({ provider: 'focus-nfe', raw: getMessage(e) }),
  }),
}

export const anthropicTranslator: ErrorTranslator = {
  matches: (e) => isErrorWithName(e, 'AnthropicError') || hasErrorMessage(e, /anthropic/i),
  translate: () => ({
    code: 'AI_PROVIDER_ERROR',
    message: 'Erro no provedor de IA',
    details: sanitize({ provider: 'anthropic' }),
  }),
}

export const geminiTranslator: ErrorTranslator = {
  matches: (e) =>
    isErrorWithName(e, 'GoogleAIError') || hasErrorMessage(e, /vertex|gemini/i),
  translate: () => ({
    code: 'AI_PROVIDER_ERROR',
    message: 'Erro no provedor de IA',
    details: sanitize({ provider: 'vertex-gemini' }),
  }),
}

export const groqTranslator: ErrorTranslator = {
  matches: (e) => isErrorWithName(e, 'GroqError') || hasErrorMessage(e, /groq/i),
  translate: () => ({
    code: 'AI_PROVIDER_ERROR',
    message: 'Erro no provedor de transcrição',
    details: sanitize({ provider: 'groq' }),
  }),
}

export const openaiTranslator: ErrorTranslator = {
  matches: (e) => isErrorWithName(e, 'OpenAIError') || hasErrorMessage(e, /openai/i),
  translate: () => ({
    code: 'AI_PROVIDER_ERROR',
    message: 'Erro no provedor de IA',
    details: sanitize({ provider: 'openai' }),
  }),
}

export const twilioTranslator: ErrorTranslator = {
  matches: (e) => isErrorWithName(e, 'TwilioError'),
  translate: () => ({
    code: 'SERVICE_UNAVAILABLE',
    message: 'WhatsApp temporariamente indisponível',
    details: sanitize({ provider: 'twilio' }),
  }),
}

export const tissTranslator: ErrorTranslator = {
  matches: (e) => isErrorWithName(e, 'TissValidationError'),
  translate: (e) => ({
    code: 'VALIDATION_ERROR',
    message: getMessage(e, 'Falha na validação TISS'),
    details: sanitize({ provider: 'tiss' }),
  }),
}

export const pluggyTranslator: ErrorTranslator = {
  matches: (e) => isErrorWithName(e, 'PluggyError'),
  translate: () => ({
    code: 'SERVICE_UNAVAILABLE',
    message: 'Open Finance temporariamente indisponível',
    details: sanitize({ provider: 'pluggy' }),
  }),
}

export const genericTranslator: ErrorTranslator = {
  matches: () => true,
  translate: (e) => ({
    code: 'INTERNAL_ERROR',
    message: 'Erro interno; estamos investigando',
    details: sanitize({ raw: getMessage(e) }),
  }),
}

export const TRANSLATORS: ErrorTranslator[] = [
  zodTranslator,
  asaasTranslator,
  focusNfeTranslator,
  anthropicTranslator,
  geminiTranslator,
  groqTranslator,
  openaiTranslator,
  twilioTranslator,
  tissTranslator,
  pluggyTranslator,
  genericTranslator,
]

export function translate(
  error: unknown,
  ctx: { request_id: string; module: string; tenantId?: string },
): Omit<ApiError, 'fingerprint'> {
  for (const t of TRANSLATORS) {
    if (t.matches(error)) {
      const partial = t.translate(error, ctx)
      return { ...partial, request_id: ctx.request_id }
    }
  }
  return { code: 'INTERNAL_ERROR', message: 'Erro interno', request_id: ctx.request_id }
}
