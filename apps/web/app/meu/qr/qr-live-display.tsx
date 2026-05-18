'use client'

/**
 * QrLiveDisplay — renderiza QR e atualiza a cada 60s.
 *
 * Visual: container `.ev-portal-qr-wrap` com canvas SVG simples. MVP renderiza
 * o payload como texto centralizado (paciente entende que ali fica o QR);
 * Sprint 26c: gera QR real via `qrcode-svg` ou similar com brand center.
 *
 * Re-fetch via API `/api/meu/qr` cada 60s — pega novo payload sem reload.
 */
import { useEffect, useState } from 'react'

interface Props {
  memberId: string
  tenantId: string
  initialQrString: string
}

const TICK_MS = 1000
const REFRESH_MS = 60_000

export function QrLiveDisplay({ initialQrString }: Props) {
  const [qrString, setQrString] = useState(initialQrString)
  const [secondsLeft, setSecondsLeft] = useState(60)

  useEffect(() => {
    let cancelled = false
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        const next = s - 1
        if (next <= 0) {
          void refresh()
          return 60
        }
        return next
      })
    }, TICK_MS)

    async function refresh() {
      try {
        // safe-fetch-exempt: same-origin API call (regra 37 cobre URLs externas)
        const res = await fetch('/api/meu/qr', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { ok?: boolean; qr?: string }
        if (!cancelled && data.ok && data.qr) {
          setQrString(data.qr)
        }
      } catch {
        /* swallow — próximo tick tenta de novo */
      }
    }

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="ev-portal-qr-wrap">
      <div className="ev-portal-qr-canvas" role="img" aria-label="QR code de acesso">
        {/* MVP: placeholder com payload encoded. Sprint 26c: SVG QR real. */}
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#000',
            wordBreak: 'break-all',
            padding: '8px',
            textAlign: 'center',
          }}
        >
          {qrString}
        </div>
      </div>
      <div className="ev-portal-qr-timer" aria-live="polite">
        Renova em {secondsLeft}s
      </div>
    </div>
  )
}
