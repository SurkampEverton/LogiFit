/**
 * <EvolutionChart /> — Generative UI Sprint 28.
 *
 * Gráfico de linha SVG nativo (sem dependência externa). Mostra evolução de
 * uma métrica ao longo do tempo. Faixa de referência opcional vira faixa
 * verde ao fundo.
 *
 * Sprint 28b: substituir por Recharts pra tooltips, zoom, etc.
 */
import type { ReactNode } from 'react'

export interface EvolutionChartProps {
  memberId: string
  metric: string
  unit?: string
  points: Array<{ at: string; value: number }>
  referenceRange?: { min: number; max: number; label?: string } | null
}

const WIDTH = 480
const HEIGHT = 200
const PADDING = { top: 16, right: 16, bottom: 32, left: 40 }

export function EvolutionChart(props: EvolutionChartProps): ReactNode {
  const pts = [...props.points].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )
  if (pts.length < 2) {
    return (
      <div
        style={{
          padding: 'var(--ev-space-4)',
          backgroundColor: 'var(--ev-surface)',
          border: '1px dashed var(--ev-border)',
          borderRadius: 'var(--ev-radius-md)',
          color: 'var(--ev-text-muted)',
          fontSize: 'var(--ev-text-sm)',
        }}
      >
        Dados insuficientes para gráfico de {props.metric}.
      </div>
    )
  }

  const values = pts.map((p) => p.value)
  const ref = props.referenceRange
  const minY = Math.min(...values, ref?.min ?? Number.POSITIVE_INFINITY)
  const maxY = Math.max(...values, ref?.max ?? Number.NEGATIVE_INFINITY)
  const padY = (maxY - minY) * 0.1 || 1
  const y0 = minY - padY
  const y1 = maxY + padY

  const xRangeStart = new Date(pts[0]!.at).getTime()
  const xRangeEnd = new Date(pts.at(-1)!.at).getTime()
  const xSpan = xRangeEnd - xRangeStart || 1

  function toX(ms: number): number {
    return (
      PADDING.left + ((ms - xRangeStart) / xSpan) * (WIDTH - PADDING.left - PADDING.right)
    )
  }
  function toY(v: number): number {
    return (
      PADDING.top + (1 - (v - y0) / (y1 - y0)) * (HEIGHT - PADDING.top - PADDING.bottom)
    )
  }

  const pathD = pts
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${toX(new Date(p.at).getTime()).toFixed(2)} ${toY(p.value).toFixed(2)}`,
    )
    .join(' ')

  const delta = pts.at(-1)!.value - pts[0]!.value
  const deltaPct = (delta / Math.abs(pts[0]!.value || 1)) * 100

  return (
    <div
      style={{
        padding: 'var(--ev-space-4)',
        backgroundColor: 'var(--ev-surface)',
        border: '1px solid var(--ev-border)',
        borderRadius: 'var(--ev-radius-md)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 'var(--ev-space-2)',
        }}
      >
        <div style={{ fontWeight: 'var(--ev-weight-semibold)' }}>
          {props.metric} {props.unit ? `(${props.unit})` : ''}
        </div>
        <div
          style={{
            fontSize: 'var(--ev-text-sm)',
            color: delta >= 0 ? 'var(--ev-success-hover)' : 'var(--ev-danger-hover)',
          }}
        >
          Δ {delta >= 0 ? '+' : ''}
          {delta.toFixed(2)}
          {props.unit ?? ''} ({deltaPct >= 0 ? '+' : ''}
          {deltaPct.toFixed(1)}%)
        </div>
      </header>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: '100%', height: 'auto', maxWidth: WIDTH }}
        aria-label={`Gráfico de evolução de ${props.metric}`}
        role="img"
      >
        {/* Faixa de referência */}
        {ref ? (
          <rect
            x={PADDING.left}
            y={toY(ref.max)}
            width={WIDTH - PADDING.left - PADDING.right}
            height={Math.max(0, toY(ref.min) - toY(ref.max))}
            fill="var(--ev-success-soft)"
            opacity={0.5}
          />
        ) : null}
        {/* Eixos */}
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={HEIGHT - PADDING.bottom}
          y2={HEIGHT - PADDING.bottom}
          stroke="var(--ev-border)"
        />
        <line
          x1={PADDING.left}
          x2={PADDING.left}
          y1={PADDING.top}
          y2={HEIGHT - PADDING.bottom}
          stroke="var(--ev-border)"
        />
        {/* Labels Y */}
        <text
          x={PADDING.left - 6}
          y={toY(y1) + 4}
          fontSize={11}
          textAnchor="end"
          fill="var(--ev-text-muted)"
        >
          {y1.toFixed(1)}
        </text>
        <text
          x={PADDING.left - 6}
          y={toY(y0) + 4}
          fontSize={11}
          textAnchor="end"
          fill="var(--ev-text-muted)"
        >
          {y0.toFixed(1)}
        </text>
        {/* Labels X início/fim */}
        <text
          x={PADDING.left}
          y={HEIGHT - PADDING.bottom + 14}
          fontSize={11}
          textAnchor="start"
          fill="var(--ev-text-muted)"
        >
          {new Date(pts[0]!.at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - PADDING.bottom + 14}
          fontSize={11}
          textAnchor="end"
          fill="var(--ev-text-muted)"
        >
          {new Date(pts.at(-1)!.at).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
          })}
        </text>
        {/* Linha */}
        <path d={pathD} fill="none" stroke="var(--ev-primary)" strokeWidth={2} />
        {/* Pontos */}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={toX(new Date(p.at).getTime())}
            cy={toY(p.value)}
            r={3}
            fill="var(--ev-primary)"
          />
        ))}
      </svg>

      {ref?.label ? (
        <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
          Faixa de referência: {ref.label} ({ref.min}–{ref.max})
        </div>
      ) : null}
    </div>
  )
}
