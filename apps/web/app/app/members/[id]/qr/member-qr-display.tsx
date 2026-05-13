'use client'

/**
 * QR display rotativo — Sprint 08 Faixa C.
 *
 * Renderiza QR como SVG inline gerado server-side via API `/api/acesso/qr/[id]`.
 * Sprint 09+ pode usar lib `qrcode` no client pra reduzir round-trip; MVP usa
 * polling pra simplicidade.
 *
 * Atualiza:
 *   - On mount
 *   - A cada 30s (refresh antes de expirar)
 *   - On visibility change (tab volta a ficar visível → refresh imediato)
 */

import { useEffect, useState } from 'react'

interface QrResponse {
  token: string
  nextRefreshMs: number
  rotationSec: number
}

/**
 * Renderiza QR como SVG inline simples sem dependência de lib externa.
 * Algoritmo: dada string `value`, gera grid 25x25 com pseudo-pattern visual.
 * NOTA: este é PLACEHOLDER MVP — não é leitor-compatível.
 * Sprint 09+ substitui por `qrcode` npm package (12KB).
 */
function QrPlaceholder({ value }: { value: string }) {
  // Hash simples pra pattern visual deterministico
  let seed = 0
  for (let i = 0; i < value.length; i++) {
    seed = ((seed << 5) - seed + value.charCodeAt(i)) | 0
  }
  const cells: boolean[] = []
  let s = Math.abs(seed)
  for (let i = 0; i < 625; i++) {
    s = (s * 9301 + 49297) % 233280
    cells.push(s / 233280 > 0.5)
  }
  return (
    <svg
      viewBox="0 0 25 25"
      width="280"
      height="280"
      style={{ display: 'block', margin: '0 auto' }}
      aria-label="QR code de acesso"
    >
      <rect width="25" height="25" fill="white" />
      {cells.map((on, i) => {
        const x = i % 25
        const y = Math.floor(i / 25)
        if (!on) return null
        return <rect key={i} x={x} y={y} width="1" height="1" fill="black" />
      })}
      {/* Finder patterns (3 cantos) */}
      {[
        [0, 0],
        [18, 0],
        [0, 18],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="7" height="7" fill="black" />
          <rect x={(x ?? 0) + 1} y={(y ?? 0) + 1} width="5" height="5" fill="white" />
          <rect x={(x ?? 0) + 2} y={(y ?? 0) + 2} width="3" height="3" fill="black" />
        </g>
      ))}
    </svg>
  )
}

export function MemberQrDisplay({ memberId }: { memberId: string }) {
  const [data, setData] = useState<QrResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number>(60)

  async function fetchQr() {
    try {
      const res = await fetch(`/api/acesso/qr/${memberId}`, { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string; error?: string }
        setError(body.message ?? body.error ?? 'Erro ao buscar QR')
        return
      }
      const json = (await res.json()) as QrResponse
      setData(json)
      setError(null)
      setCountdown(Math.ceil(json.nextRefreshMs / 1000))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro de rede')
    }
  }

  useEffect(() => {
    fetchQr()
    // biome-ignore lint/correctness/useExhaustiveDependencies: fetchQr referencia memberId
  }, [memberId])

  // Auto-refresh 30s (antes do token vencer 60s)
  useEffect(() => {
    const id = setInterval(() => {
      fetchQr()
    }, 30_000)
    return () => clearInterval(id)
    // biome-ignore lint/correctness/useExhaustiveDependencies: fetchQr não muda durante lifecycle
  }, [])

  // Countdown visual
  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [data])

  // Refresh on tab visible
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === 'visible') fetchQr()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
    // biome-ignore lint/correctness/useExhaustiveDependencies: fetchQr não muda
  }, [])

  if (error) {
    return (
      <div role="alert" className="rounded-md border border-[color:var(--ev-danger)] p-4 text-sm">
        <p className="font-semibold text-[color:var(--ev-danger)]">Erro</p>
        <p>{error}</p>
        <button
          type="button"
          onClick={fetchQr}
          className="mt-2 rounded-md border border-[color:var(--ev-border)] px-3 py-1.5 text-xs"
        >
          Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[color:var(--ev-border)] bg-white p-4">
        {data ? (
          <QrPlaceholder value={data.token} />
        ) : (
          <div className="h-[280px] flex items-center justify-center text-sm text-[color:var(--ev-text-muted)]">
            Carregando QR…
          </div>
        )}
      </div>
      <div className="text-center text-xs text-[color:var(--ev-text-muted)] tabular-nums">
        {data ? `Atualiza em ${countdown}s` : 'aguarde…'}
      </div>
      <p className="text-xs text-center text-[color:var(--ev-warning, #f59e0b)]">
        ⚠ MVP: QR é placeholder visual. Sprint 09+ usa lib qrcode pra QR
        leitor-compatível real (~12KB bundle).
      </p>
    </div>
  )
}
