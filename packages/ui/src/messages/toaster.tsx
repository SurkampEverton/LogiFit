'use client'
import { Toaster as SonnerToaster } from 'sonner'

interface ToasterProps {
  /**
   * CSP nonce (regra 35). Lido pelo `app/layout.tsx` via `headers().get('x-nonce')`
   * e propagado pra Sonner que injeta em scripts internos.
   */
  nonce?: string
}

/**
 * Toaster único do app (regra 45 + ADR 0089). Renderizado uma vez no
 * `app/layout.tsx`, dentro do `<body>` e fora de qualquer Suspense boundary.
 *
 * Tokens EV via CSS custom properties — sem hardcode (regra 44).
 */
export function Toaster({ nonce }: ToasterProps) {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      nonce={nonce}
      toastOptions={{
        style: {
          background: 'var(--ev-surface)',
          color: 'var(--ev-text)',
          border: '1px solid var(--ev-border)',
        },
      }}
    />
  )
}
