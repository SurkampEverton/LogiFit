/**
 * <MeasurementComparison /> — Generative UI Sprint 28.
 *
 * Tabela compacta comparando medições entre duas datas. Direção desejada
 * (`lower`/`higher`/`stable`) decide cor do delta (verde = na direção,
 * vermelho = contra, cinza = stable).
 */
import type { ReactNode } from 'react'

export interface ComparisonMetric {
  name: string
  unit?: string
  before: number
  after: number
  desiredDirection: 'lower' | 'higher' | 'stable'
}

export interface MeasurementComparisonProps {
  memberId: string
  metrics: ComparisonMetric[]
  beforeAt: string
  afterAt: string
}

function deltaColor(metric: ComparisonMetric): string {
  const delta = metric.after - metric.before
  if (metric.desiredDirection === 'stable') {
    return Math.abs(delta) < 0.5 * (Math.abs(metric.before) * 0.05 + 0.01)
      ? 'var(--ev-success-hover)'
      : 'var(--ev-warning-hover)'
  }
  if (metric.desiredDirection === 'lower') {
    return delta < 0 ? 'var(--ev-success-hover)' : delta > 0 ? 'var(--ev-danger-hover)' : 'var(--ev-text-muted)'
  }
  return delta > 0 ? 'var(--ev-success-hover)' : delta < 0 ? 'var(--ev-danger-hover)' : 'var(--ev-text-muted)'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function MeasurementComparison(props: MeasurementComparisonProps): ReactNode {
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
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 'var(--ev-space-2)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--ev-text-base)' }}>Comparação de medições</h3>
        <span style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
          {formatDate(props.beforeAt)} → {formatDate(props.afterAt)}
        </span>
      </header>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ev-text-sm)' }}>
        <thead>
          <tr
            style={{
              borderBottom: '1px solid var(--ev-border)',
              color: 'var(--ev-text-muted)',
              fontSize: 'var(--ev-text-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <th style={{ textAlign: 'left', padding: 'var(--ev-space-1) 0' }}>Métrica</th>
            <th style={{ textAlign: 'right', padding: 'var(--ev-space-1) 0' }}>Antes</th>
            <th style={{ textAlign: 'right', padding: 'var(--ev-space-1) 0' }}>Depois</th>
            <th style={{ textAlign: 'right', padding: 'var(--ev-space-1) 0' }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {props.metrics.map((m) => {
            const delta = m.after - m.before
            const pct = (delta / Math.abs(m.before || 1)) * 100
            return (
              <tr
                key={m.name}
                style={{ borderBottom: '1px solid var(--ev-border)' }}
              >
                <td style={{ padding: 'var(--ev-space-1) 0' }}>{m.name}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--ev-font-mono)' }}>
                  {m.before.toFixed(1)}
                  {m.unit ? ` ${m.unit}` : ''}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--ev-font-mono)' }}>
                  {m.after.toFixed(1)}
                  {m.unit ? ` ${m.unit}` : ''}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontFamily: 'var(--ev-font-mono)',
                    color: deltaColor(m),
                    fontWeight: 'var(--ev-weight-medium)',
                  }}
                >
                  {delta >= 0 ? '+' : ''}
                  {delta.toFixed(1)}
                  {m.unit ? ` ${m.unit}` : ''} ({pct >= 0 ? '+' : ''}
                  {pct.toFixed(1)}%)
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
