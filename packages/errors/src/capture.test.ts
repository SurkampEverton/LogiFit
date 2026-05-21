import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureFromBoundary, setCaptureHook } from './capture'

describe('capture hook', () => {
  afterEach(() => {
    setCaptureHook(null)
  })

  it('captureFromBoundary é no-op sem hook setado', () => {
    expect(() => captureFromBoundary(new Error('boom'))).not.toThrow()
  })

  it('captureFromBoundary delega para o hook quando setado', () => {
    const hook = vi.fn()
    setCaptureHook(hook)
    const err = new Error('boom')
    captureFromBoundary(err, { level: 'error', tags: { module: 'agenda' } })
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(err, {
      level: 'error',
      tags: { module: 'agenda' },
    })
  })

  it('hook que lança não propaga erro pro caller (defesa)', () => {
    setCaptureHook(() => {
      throw new Error('hook explodiu')
    })
    expect(() => captureFromBoundary(new Error('original'))).not.toThrow()
  })

  it('setCaptureHook(null) desativa o hook', () => {
    const hook = vi.fn()
    setCaptureHook(hook)
    setCaptureHook(null)
    captureFromBoundary(new Error('boom'))
    expect(hook).not.toHaveBeenCalled()
  })

  it('última chamada de setCaptureHook vence (idempotente)', () => {
    const hook1 = vi.fn()
    const hook2 = vi.fn()
    setCaptureHook(hook1)
    setCaptureHook(hook2)
    captureFromBoundary(new Error('boom'))
    expect(hook1).not.toHaveBeenCalled()
    expect(hook2).toHaveBeenCalledTimes(1)
  })

  it('captureFromBoundary aceita context vazio', () => {
    const hook = vi.fn()
    setCaptureHook(hook)
    captureFromBoundary(new Error('boom'))
    expect(hook).toHaveBeenCalledWith(expect.any(Error), undefined)
  })
})
