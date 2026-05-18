/**
 * <ExerciseRecommendation /> — Generative UI Sprint 28.
 *
 * Lista exercícios recomendados pelo LLM pra um objetivo terapêutico/treino.
 * Cada item pode trazer flag de contraindicação (ADR 0084):
 *   - avoid    → barra vermelha (substituir)
 *   - modify   → barra amarela (adaptar)
 *   - caution  → barra cinza (atenção)
 *   - null/undefined → sem flag (livre)
 */
import type { ReactNode } from 'react'

export interface ExerciseRecItem {
  exerciseId: string
  name: string
  muscleGroups: string[]
  contraindicationFlag?: 'avoid' | 'modify' | 'caution' | null
  sets?: number
  reps?: string
  rationale: string
}

export interface ExerciseRecommendationProps {
  goal: string
  exercises: ExerciseRecItem[]
}

const FLAG_COLOR: Record<NonNullable<ExerciseRecItem['contraindicationFlag']>, string> = {
  avoid: 'var(--ev-danger)',
  modify: 'var(--ev-warning)',
  caution: 'var(--ev-text-muted)',
}

const FLAG_LABEL: Record<NonNullable<ExerciseRecItem['contraindicationFlag']>, string> = {
  avoid: 'Evitar',
  modify: 'Adaptar',
  caution: 'Atenção',
}

export function ExerciseRecommendation(props: ExerciseRecommendationProps): ReactNode {
  return (
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
      <header>
        <h3 style={{ margin: 0, fontSize: 'var(--ev-text-base)' }}>Exercícios recomendados</h3>
        <div style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
          Objetivo: {props.goal}
        </div>
      </header>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--ev-space-2)' }}>
        {props.exercises.map((ex) => (
          <li
            key={ex.exerciseId}
            style={{
              padding: 'var(--ev-space-2)',
              borderLeft: ex.contraindicationFlag
                ? `3px solid ${FLAG_COLOR[ex.contraindicationFlag]}`
                : '3px solid var(--ev-border)',
              backgroundColor: 'var(--ev-surface-muted)',
              borderRadius: 'var(--ev-radius-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-2)' }}>
              <span style={{ fontWeight: 'var(--ev-weight-semibold)' }}>{ex.name}</span>
              {ex.contraindicationFlag ? (
                <span
                  style={{
                    fontSize: 'var(--ev-text-xs)',
                    color: FLAG_COLOR[ex.contraindicationFlag],
                    fontWeight: 'var(--ev-weight-medium)',
                  }}
                >
                  {FLAG_LABEL[ex.contraindicationFlag]}
                </span>
              ) : null}
              {ex.sets && ex.reps ? (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 'var(--ev-text-sm)',
                    color: 'var(--ev-text-muted)',
                  }}
                >
                  {ex.sets} × {ex.reps}
                </span>
              ) : null}
            </div>
            {ex.muscleGroups.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--ev-space-1)',
                  flexWrap: 'wrap',
                  marginTop: 4,
                }}
              >
                {ex.muscleGroups.map((g) => (
                  <span
                    key={g}
                    style={{
                      fontSize: 'var(--ev-text-xs)',
                      backgroundColor: 'var(--ev-primary-soft)',
                      color: 'var(--ev-primary-hover)',
                      padding: '1px var(--ev-space-2)',
                      borderRadius: 'var(--ev-radius-pill)',
                    }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            ) : null}
            <p
              style={{
                fontSize: 'var(--ev-text-xs)',
                color: 'var(--ev-text-muted)',
                margin: '4px 0 0 0',
              }}
            >
              {ex.rationale}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
