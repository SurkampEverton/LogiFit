/**
 * <PatientCard /> — Generative UI Sprint 28.
 *
 * Card resumido do paciente com nome, idade, vertical, status do contrato e
 * riscos ativos. Renderizado quando LLM retorna tool `genui.fisio.patient_card`.
 *
 * Tokens "Equilíbrio Vital" (regra 44) — sem hardcode de hex/spacing.
 */
import type { ReactNode } from 'react'

export interface PatientCardProps {
  memberId: string
  name: string
  age?: number | null
  vertical: 'academia' | 'fisio' | 'nutri' | 'personal'
  contractStatus?: 'active' | 'paused' | 'cancelled' | 'expired' | null
  lastVisitAt?: string | null
  activeRisks?: string[]
  /** Link opcional para `/app/members/[id]` */
  onClickHref?: string
}

const VERTICAL_LABEL: Record<PatientCardProps['vertical'], string> = {
  academia: 'Academia',
  fisio: 'Fisioterapia',
  nutri: 'Nutrição',
  personal: 'Personal',
}

const STATUS_LABEL: Record<NonNullable<PatientCardProps['contractStatus']>, string> = {
  active: 'Contrato ativo',
  paused: 'Trancado',
  cancelled: 'Cancelado',
  expired: 'Expirado',
}

const STATUS_COLOR: Record<NonNullable<PatientCardProps['contractStatus']>, string> = {
  active: 'var(--ev-success)',
  paused: 'var(--ev-warning)',
  cancelled: 'var(--ev-text-muted)',
  expired: 'var(--ev-danger)',
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function PatientCard(props: PatientCardProps): ReactNode {
  const body = (
    <div
      style={{
        padding: 'var(--ev-space-4)',
        backgroundColor: 'var(--ev-surface)',
        border: '1px solid var(--ev-border)',
        borderRadius: 'var(--ev-radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ev-space-2)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--ev-space-2)',
        }}
      >
        <div>
          <div style={{ fontWeight: 'var(--ev-weight-semibold)', fontSize: 'var(--ev-text-lg)' }}>
            {props.name}
          </div>
          <div style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
            {props.age != null ? `${props.age} anos · ` : ''}
            {VERTICAL_LABEL[props.vertical]}
          </div>
        </div>
        {props.contractStatus ? (
          <span
            style={{
              fontSize: 'var(--ev-text-xs)',
              fontWeight: 'var(--ev-weight-medium)',
              color: STATUS_COLOR[props.contractStatus],
              whiteSpace: 'nowrap',
            }}
          >
            ● {STATUS_LABEL[props.contractStatus]}
          </span>
        ) : null}
      </header>

      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 'var(--ev-space-1) var(--ev-space-2)',
          fontSize: 'var(--ev-text-sm)',
        }}
      >
        <dt style={{ color: 'var(--ev-text-muted)' }}>Última visita</dt>
        <dd style={{ margin: 0 }}>{formatDate(props.lastVisitAt)}</dd>
      </dl>

      {props.activeRisks && props.activeRisks.length > 0 ? (
        <div style={{ display: 'flex', gap: 'var(--ev-space-1)', flexWrap: 'wrap' }}>
          {props.activeRisks.map((risk) => (
            <span
              key={risk}
              style={{
                backgroundColor: 'var(--ev-warning-soft)',
                color: 'var(--ev-warning-hover)',
                padding: '2px var(--ev-space-2)',
                borderRadius: 'var(--ev-radius-pill)',
                fontSize: 'var(--ev-text-xs)',
              }}
            >
              ⚠ {risk}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )

  if (props.onClickHref) {
    return (
      <a href={props.onClickHref} style={{ textDecoration: 'none', color: 'inherit' }}>
        {body}
      </a>
    )
  }
  return body
}
