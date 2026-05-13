'use client'

/**
 * `<RealtimeRefresh>` — listener SSE pra eventos da agenda (Sprint 03 Faixa D).
 *
 * Plugado em `/app/agenda/page.tsx` + `/app/agenda/week/page.tsx`. Cada evento
 * recebido dispara `router.refresh()` (Server Component re-renderiza com dados
 * atualizados via RSC).
 *
 * Tolerante a falhas: se conexão SSE cair, browser auto-reconnect via
 * `EventSource` default (~3s). Erros log no console — não bloqueia UI.
 *
 * **Sem estado UI próprio** — só efeito colateral. Pode ser plugado em qualquer
 * rota /app/agenda/* que renderiza dados de appointments.
 */

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function RealtimeRefresh({
  endpoint = '/api/realtime/agenda',
}: {
  endpoint?: string
}) {
  const router = useRouter()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const es = new EventSource(endpoint)

    es.addEventListener('agenda', () => {
      router.refresh()
    })

    es.addEventListener('error', (e) => {
      // EventSource auto-reconecta por default; só logamos
      console.warn('[realtime] agenda SSE error', e)
    })

    return () => {
      es.close()
    }
  }, [endpoint, router])

  return null
}
