'use client'
import { ConfirmDialog } from './confirm-dialog'
import { PromptDialog } from './prompt-dialog'

/**
 * MessageHost — agrega listeners imperativos do catálogo de mensagens
 * (regra 45 + ADR 0089). Monte uma única vez em `app/layout.tsx` ao lado
 * do `<Toaster>` pra habilitar `confirm()` e `prompt()` em qualquer client
 * component da árvore.
 *
 * `<AlertDialog>` é declarativo (controlado por `open` prop) — não precisa
 * estar no host; caller renderiza onde precisar.
 */
export function MessageHost(): React.ReactElement {
  return (
    <>
      <ConfirmDialog />
      <PromptDialog />
    </>
  )
}
