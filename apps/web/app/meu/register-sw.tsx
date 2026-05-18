'use client'

/**
 * Registra service worker do portal — Sprint 26 Faixa C (26b).
 *
 * Componente client renderizado no layout. Roda 1× no mount + atualiza
 * service worker em background quando arquivo muda (skipWaiting force).
 *
 * Não renderiza nada visível.
 */
import { useEffect } from 'react'

export function RegisterSw() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return // só em prod

    const url = '/meu/sw.js'
    navigator.serviceWorker
      .register(url, { scope: '/meu' })
      .then(() => {
        /* registered */
      })
      .catch(() => {
        /* swallow — falha de registro não bloqueia paciente */
      })
  }, [])

  return null
}
