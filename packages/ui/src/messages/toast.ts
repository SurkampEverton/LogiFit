'use client'
import { toast as sonnerToast } from 'sonner'
import type { ApiError } from '@repo/errors'

/**
 * Helpers imperativos de toast (regra 45 + ADR 0089).
 *
 * Mensagens DEVEM vir de t('namespace.key') de next-intl (regra 27) — o lint
 * custom `no-hardcoded-toast-message` (Faixa 4) bloqueia string literal.
 */
export interface ToastOptions {
  description?: string
  action?: { label: string; onClick: () => void }
  duration?: number
}

export const toast = {
  success(message: string, options?: ToastOptions) {
    return sonnerToast.success(message, options)
  },
  info(message: string, options?: ToastOptions) {
    return sonnerToast.info(message, options)
  },
  warning(message: string, options?: ToastOptions) {
    return sonnerToast.warning(message, options)
  },
  error(message: string, options?: ToastOptions) {
    return sonnerToast.error(message, options)
  },
  /**
   * Critical = erro grave que exige acknowledge explícito (sem auto-dismiss).
   * Use para `INTERNAL_ERROR` e quebras de hash chain (regra 39).
   */
  critical(message: string, options?: ToastOptions) {
    return sonnerToast.error(message, {
      ...options,
      duration: Number.POSITIVE_INFINITY,
    })
  },
  /**
   * Consome envelope ApiError (ADR 0071). Severidade derivada do código,
   * `request_id` aparece como description (com botão copy futuro).
   */
  fromApiError(error: ApiError) {
    const isCritical =
      error.code === 'INTERNAL_ERROR' || error.code === 'SERVICE_UNAVAILABLE'
    const fn = isCritical ? toast.critical : toast.error
    return fn(error.message, {
      description: `request_id: ${error.request_id}`,
      duration: isCritical ? Number.POSITIVE_INFINITY : 8000,
    })
  },
}
