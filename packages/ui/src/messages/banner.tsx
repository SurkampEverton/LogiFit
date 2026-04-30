import type { ReactNode } from 'react'

/**
 * Banner — estado persistente da página/tenant (regra 45 + ADR 0089).
 * Diferente de Toast (efêmero, pós-ação) — Banner permanece até o usuário
 * dispensar ou condição mudar. Sticky no topo do <AppLayout> em geral.
 *
 * Sprint 00: variant + ARIA + tokens EV. dismissible (interativo) chega
 * Sprint 01a quando primeiro consumidor real precisar.
 */
export type BannerVariant = 'info' | 'warning' | 'danger'

interface BannerProps {
  variant?: BannerVariant
  children: ReactNode
}

const VARIANT_BG: Record<BannerVariant, string> = {
  info: 'var(--ev-primary-soft)',
  warning: 'var(--ev-warning-soft)',
  danger: 'var(--ev-danger-soft)',
}

const VARIANT_BORDER: Record<BannerVariant, string> = {
  info: 'var(--ev-primary)',
  warning: 'var(--ev-warning)',
  danger: 'var(--ev-danger)',
}

export function Banner({ variant = 'info', children }: BannerProps) {
  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      aria-live={variant === 'danger' ? 'assertive' : 'polite'}
      style={{
        backgroundColor: VARIANT_BG[variant],
        borderLeft: `4px solid ${VARIANT_BORDER[variant]}`,
        padding: 'var(--ev-space-3) var(--ev-space-4)',
        color: 'var(--ev-text)',
      }}
    >
      {children}
    </div>
  )
}
