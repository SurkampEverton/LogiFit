/**
 * Envelope canônico de erros (ADR 0071 + regra 33).
 *
 * Toda Server Action / API Route / Job retorna ApiResult<T>:
 *   { ok: true, data: T } | { ok: false, error: ApiError }
 *
 * 16 códigos fechados — adicionar exige ADR. Sem códigos abertos.
 */

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'AI_QUOTA_EXCEEDED',
  'AI_PROVIDER_ERROR',
  'PAYMENT_FAILED',
  'FISCAL_REJECTED',
  'CONSENT_REQUIRED',
  'COMMITTEE_REQUIRED',
  'SLUG_TAKEN',
  'TENANT_SUSPENDED',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export interface ApiError {
  code: ApiErrorCode
  message: string
  request_id: string
  runbook?: string
  retry_after_ms?: number
  fingerprint?: string
  details?: Record<string, unknown>
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export class ApiException extends Error {
  readonly code: ApiErrorCode
  readonly request_id: string
  readonly runbook?: string
  readonly retry_after_ms?: number
  readonly details?: Record<string, unknown>

  constructor(error: Omit<ApiError, 'fingerprint'>) {
    super(error.message)
    this.name = 'ApiException'
    this.code = error.code
    this.request_id = error.request_id
    this.runbook = error.runbook
    this.retry_after_ms = error.retry_after_ms
    this.details = error.details
  }
}

export function isApiException(value: unknown): value is ApiException {
  return value instanceof ApiException
}

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

export function err(error: ApiError): ApiResult<never> {
  return { ok: false, error }
}
