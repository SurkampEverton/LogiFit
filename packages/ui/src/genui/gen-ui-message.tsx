/**
 * <GenUIMessage /> — renderer principal Sprint 28.
 *
 * Recebe lista de blocos `GenUIMessageBlock` (text | tool_call) + lista de
 * tool calls **já validadas** (via `validateToolCall`) e renderiza:
 *   - text → <p>
 *   - tool_call → componente correspondente (via dispatch interno)
 *   - tool_call não-registrada / inválida → fallback de texto curto + warning
 *
 * Mantém **dispatch fixo** (não dinâmico) — guardrail regra 28 / ADR 0085:
 * componentes são módulos importados explicitamente, LLM nunca controla qual
 * componente é renderizado além do nome canônico.
 */
import type { ReactNode } from 'react'
import { CidSuggestion, type CidSuggestionProps } from './cid-suggestion'
import { EvolutionChart, type EvolutionChartProps } from './evolution-chart'
import {
  ExerciseRecommendation,
  type ExerciseRecommendationProps,
} from './exercise-recommendation'
import {
  MeasurementComparison,
  type MeasurementComparisonProps,
} from './measurement-comparison'
import { PatientCard, type PatientCardProps } from './patient-card'
import { ReportSection, type ReportSectionProps } from './report-section'

/** Espelho mínimo dos tipos de `@repo/ai/genui` — evita ciclo de import */
export interface ToolCallLike {
  id: string
  name: string
  args: unknown
}

export interface GenUIMessageBlockLike {
  kind: 'text' | 'tool_call' | 'invalid'
  /** kind='text' */
  content?: string
  /** kind='tool_call' */
  call?: ToolCallLike
  /** kind='invalid' — render fallback */
  reason?: string
}

export interface GenUIMessageProps {
  blocks: GenUIMessageBlockLike[]
  /** Callback opcional ao clicar "Adicionar CID" (caller wireia SA Sprint 20) */
  onAddCid?: CidSuggestionProps['onAdd']
}

/**
 * Dispatch fixo: nome canônico → componente. Adição de componente novo exige
 * 1) registrar tool em `@repo/ai/genui/tools.ts` e 2) adicionar entrada aqui.
 * Esse "duplo registro" é proposital — força revisão de PR pra cada novo
 * componente clínico (auditável + regra 28).
 */
function renderToolCall(call: ToolCallLike, onAddCid?: GenUIMessageProps['onAddCid']): ReactNode {
  switch (call.name) {
    case 'genui.fisio.patient_card':
      return <PatientCard {...(call.args as PatientCardProps)} />
    case 'genui.fisio.evolution_chart':
      return <EvolutionChart {...(call.args as EvolutionChartProps)} />
    case 'genui.fisio.cid_suggestion':
      return <CidSuggestion {...(call.args as CidSuggestionProps)} onAdd={onAddCid} />
    case 'genui.fisio.exercise_recommendation':
      return <ExerciseRecommendation {...(call.args as ExerciseRecommendationProps)} />
    case 'genui.geral.measurement_comparison':
      return <MeasurementComparison {...(call.args as MeasurementComparisonProps)} />
    case 'genui.geral.report_section':
      return <ReportSection {...(call.args as ReportSectionProps)} />
    default:
      return (
        <div
          style={{
            padding: 'var(--ev-space-3)',
            border: '1px dashed var(--ev-warning)',
            borderRadius: 'var(--ev-radius-sm)',
            color: 'var(--ev-text-muted)',
            fontSize: 'var(--ev-text-sm)',
          }}
        >
          [Componente <code>{call.name}</code> não registrado — fallback]
        </div>
      )
  }
}

export function GenUIMessage(props: GenUIMessageProps): ReactNode {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ev-space-3)',
      }}
    >
      {props.blocks.map((b, i) => {
        if (b.kind === 'text' && b.content) {
          return (
            <p key={i} style={{ margin: 0, lineHeight: 'var(--ev-leading-normal)' }}>
              {b.content}
            </p>
          )
        }
        if (b.kind === 'tool_call' && b.call) {
          return <div key={i}>{renderToolCall(b.call, props.onAddCid)}</div>
        }
        if (b.kind === 'invalid') {
          return (
            <div
              key={i}
              style={{
                padding: 'var(--ev-space-2)',
                backgroundColor: 'var(--ev-warning-soft)',
                color: 'var(--ev-warning-hover)',
                borderRadius: 'var(--ev-radius-sm)',
                fontSize: 'var(--ev-text-sm)',
              }}
            >
              ⚠ Componente inválido: {b.reason ?? 'desconhecido'}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
