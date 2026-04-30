'use client'
/**
 * PromptDialog — substitui `window.prompt()` (proibido pela regra 45).
 *
 * Sprint 00: contrato. Implementação real Sprint 01a com input + validator
 * + <FormError> linkado via aria-describedby.
 *
 * Exemplo:
 *   const reason = await prompt({
 *     title: t('action.cancel_reason'),
 *     label: t('action.reason_label'),
 *     validator: (v) => v.length >= 10 ? null : t('errors.too_short'),
 *   })
 *   if (reason) await cancelGuide({ reason })
 */
export interface PromptOptions {
  title: string
  label: string
  initial?: string
  validator?: (value: string) => string | null
  confirmLabel?: string
  cancelLabel?: string
}

export async function prompt(_options: PromptOptions): Promise<string | null> {
  throw new Error('prompt() not implemented yet — Sprint 01a')
}

export function PromptDialog(): null {
  return null
}
