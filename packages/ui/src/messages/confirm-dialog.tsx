'use client'
import type { ReactNode } from 'react'

/**
 * ConfirmDialog — substitui `window.confirm()` (proibido pela regra 45).
 *
 * Sprint 00: contrato. Implementação real Sprint 01a (Radix Dialog wrapper).
 *
 * Exemplo de uso:
 *   const ok = await confirm({ title: t('action.delete_title'), body: t('...'), danger: true })
 *   if (ok) await deleteItem()
 */
export interface ConfirmOptions {
  title: string
  body: ReactNode
  danger?: boolean
  confirmLabel?: string
  cancelLabel?: string
}

export async function confirm(_options: ConfirmOptions): Promise<boolean> {
  throw new Error('confirm() not implemented yet — Sprint 01a (Radix Dialog wrapper)')
}

export function ConfirmDialog(): null {
  // TODO Sprint 01a: implementar componente render (vem com confirm() ativo)
  return null
}
