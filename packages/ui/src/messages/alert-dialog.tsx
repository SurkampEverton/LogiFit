'use client'
import type { ReactNode } from 'react'

/**
 * AlertDialog — substitui `window.alert()` (proibido pela regra 45).
 *
 * Sprint 00: shape definido. Implementação real (Sprint 01a) usa Radix Dialog
 * base + tokens EV + bottom-sheet em mobile / centered em desktop (reusa
 * <ResponsiveModal>); a11y `role="alertdialog"` + `aria-modal` + focus trap.
 */
export interface AlertDialogProps {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel?: string
  onClose: () => void
}

export function AlertDialog(_props: AlertDialogProps): null {
  // TODO Sprint 01a: implementar com Radix Dialog
  return null
}
