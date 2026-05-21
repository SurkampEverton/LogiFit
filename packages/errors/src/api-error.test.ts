import { describe, expect, it } from 'vitest'
import { API_ERROR_CODES, ApiException, err, isApiException, ok } from './api-error'

describe('API_ERROR_CODES', () => {
  it('contém os 17 códigos canônicos (16 ADR 0071 + MFA_RECENT_REQUIRED Sprint 02b)', () => {
    expect(API_ERROR_CODES).toHaveLength(17)
    expect(API_ERROR_CODES).toContain('VALIDATION_ERROR')
    expect(API_ERROR_CODES).toContain('UNAUTHORIZED')
    expect(API_ERROR_CODES).toContain('FORBIDDEN')
    expect(API_ERROR_CODES).toContain('INTERNAL_ERROR')
    expect(API_ERROR_CODES).toContain('MFA_RECENT_REQUIRED')
  })

  it('readonly tuple (não muta)', () => {
    expect(Object.isFrozen(API_ERROR_CODES)).toBe(false) // const tuple, não frozen
    // mas TS bloqueia mutação via tipo — verificamos pelo tipo
    const codes: typeof API_ERROR_CODES = API_ERROR_CODES
    expect(codes[0]).toBe('VALIDATION_ERROR')
  })
})

describe('ok / err helpers', () => {
  it('ok envolve data em { ok: true }', () => {
    const result = ok({ id: 'abc' })
    expect(result).toEqual({ ok: true, data: { id: 'abc' } })
  })

  it('err envolve error em { ok: false }', () => {
    const error = {
      code: 'NOT_FOUND' as const,
      message: 'paciente não encontrado',
      request_id: 'req-123',
    }
    const result = err(error)
    expect(result).toEqual({ ok: false, error })
  })

  it('ok aceita null como data válido', () => {
    expect(ok(null)).toEqual({ ok: true, data: null })
  })

  it('discriminação por ok funciona com type narrowing', () => {
    const result: ReturnType<typeof ok<string>> | ReturnType<typeof err> = ok('hello')
    if (result.ok) {
      expect(result.data).toBe('hello')
    } else {
      throw new Error('should have been ok')
    }
  })
})

describe('ApiException', () => {
  it('herda de Error com name customizado', () => {
    const ex = new ApiException({
      code: 'FORBIDDEN',
      message: 'sem permissão',
      request_id: 'req-x',
    })
    expect(ex).toBeInstanceOf(Error)
    expect(ex.name).toBe('ApiException')
    expect(ex.message).toBe('sem permissão')
  })

  it('preserva todos os campos opcionais', () => {
    const ex = new ApiException({
      code: 'RATE_LIMITED',
      message: 'too many',
      request_id: 'req-1',
      runbook: 'https://...',
      retry_after_ms: 5000,
      details: { window: '15min' },
    })
    expect(ex.code).toBe('RATE_LIMITED')
    expect(ex.runbook).toBe('https://...')
    expect(ex.retry_after_ms).toBe(5000)
    expect(ex.details).toEqual({ window: '15min' })
  })

  it('campos opcionais ausentes ficam undefined', () => {
    const ex = new ApiException({
      code: 'NOT_FOUND',
      message: 'x',
      request_id: 'r',
    })
    expect(ex.runbook).toBeUndefined()
    expect(ex.retry_after_ms).toBeUndefined()
    expect(ex.details).toBeUndefined()
  })
})

describe('isApiException', () => {
  it('retorna true pra instância de ApiException', () => {
    const ex = new ApiException({ code: 'NOT_FOUND', message: 'x', request_id: 'r' })
    expect(isApiException(ex)).toBe(true)
  })

  it('retorna false pra Error comum', () => {
    expect(isApiException(new Error('plain'))).toBe(false)
  })

  it('retorna false pra non-error values', () => {
    expect(isApiException(null)).toBe(false)
    expect(isApiException(undefined)).toBe(false)
    expect(isApiException('string')).toBe(false)
    expect(isApiException({ code: 'NOT_FOUND' })).toBe(false)
  })
})
