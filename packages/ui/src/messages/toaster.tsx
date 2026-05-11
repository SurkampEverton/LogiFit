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
 *
 * Nota: `nonce` é aceito por Sonner em runtime mas o tipo `ToasterProps` da
 * versão `^1.7` ainda não declara — propagamos via spread tipado pra evitar
 * erro de build sem perder o CSP nonce (regra 35). Sonner ≥2 já expõe.
 */
export function Toaster({ nonce }: ToasterProps) {
  // biome-ignore lint/suspicious/noExplicitAny: Sonner ^1.7 ToasterProps não declara nonce; aceito em runtime.
  const extra = { nonce } as any
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      {...extra}
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
