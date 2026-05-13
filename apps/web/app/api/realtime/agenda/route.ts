import { pool } from '@repo/db/client'
/**
 * GET /api/realtime/agenda — Server-Sent Events stream pra agenda (Sprint 03 Faixa D).
 *
 * Mantém conexão HTTP/1.1 aberta + escuta canal Postgres `agenda:{tenant_id}`.
 * Cada NOTIFY do trigger `agenda_notify_change()` (policy 0018) vira evento SSE
 * `data: {...}\n\n` no cliente.
 *
 * Cliente faz `new EventSource('/api/realtime/agenda')` + recebe payload JSON
 * com `{ event, appointment_id, tenant_id, ... }`. Tipicamente chama
 * `router.refresh()` em cada evento (revalidação de página inteira) — Sprint 04+
 * pode otimizar mergeando delta no estado client se virar gargalo.
 *
 * **Auth**: `requireFullSession` (cookie BetterAuth) → tenantId vem do claim,
 * cliente não pode escolher canal de outro tenant. Defesa em profundidade.
 *
 * **Reverse proxy**: Caddy/Cloudflare permitem chunked transfer encoding HTTP/1.1
 * por default. `X-Accel-Buffering: no` previne nginx-style buffering.
 *
 * **Limite**: 1 conexão por user/tab. Sprint 04+ pode adicionar pool sharing
 * via SharedWorker se quantidade de tabs abertas crescer.
 */
import type { PoolClient } from 'pg'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs' // pg requer Node runtime, não Edge

export async function GET(request: Request) {
  const session = await requireFullSession('/app/agenda')
  const channel = `agenda:${session.logifit.tenantId}`

  let client: PoolClient | null = null
  let isCancelled = false

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data: string) => {
        try {
          if (!isCancelled) controller.enqueue(encoder.encode(data))
        } catch {
          /* stream fechado */
        }
      }

      // Comment SSE inicial pra cliente saber que conectou + zera reconnect-time
      send(`: connected to ${channel}\n\n`)

      try {
        client = await pool.connect()
        // LISTEN no canal do tenant
        // biome-ignore lint/security/noNonNullAssertion: PoolClient.query existe
        await client.query(`LISTEN "${channel}"`)

        // pg client emite 'notification' nos LISTEN
        client.on('notification', (msg) => {
          if (msg.channel !== channel) return
          const payload = msg.payload ?? '{}'
          send(`event: agenda\ndata: ${payload}\n\n`)
        })

        // Keep-alive ping a cada 25s — previne timeout 30s de proxies HTTP/1.1
        const pingInterval = setInterval(() => {
          if (isCancelled) {
            clearInterval(pingInterval)
            return
          }
          send(`: ping\n\n`)
        }, 25_000)

        // Aguarda cancel (cliente fechou aba ou request abort)
        request.signal.addEventListener('abort', () => {
          isCancelled = true
          clearInterval(pingInterval)
          if (client) {
            client
              .query(`UNLISTEN "${channel}"`)
              .catch(() => {})
              .finally(() => {
                try {
                  client?.release()
                } catch {
                  /* swallow */
                }
              })
          }
          try {
            controller.close()
          } catch {
            /* já fechado */
          }
        })
      } catch (err) {
        send(
          `event: error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : 'unknown' })}\n\n`,
        )
        try {
          controller.close()
        } catch {
          /* swallow */
        }
      }
    },
    cancel() {
      isCancelled = true
      if (client) {
        try {
          client.release()
        } catch {
          /* swallow */
        }
        client = null
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
