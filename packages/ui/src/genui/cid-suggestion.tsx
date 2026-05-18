/**
 * <CidSuggestion /> — Generative UI Sprint 28.
 *
 * Lista de CIDs sugeridos pelo LLM com confidence + rationale. Cada item tem
 * botão "Adicionar ao prontuário" — quando `targetConsultaId` está presente,
 * dispara callback (que o caller wireia com Server Action de Sprint 20).
 *
 * **Apoio ao profissional, NÃO diagnóstico** (regra 28 CFM 2.454/2026).
 * Confidence é só ranking — output é sempre revisado pelo médico/fisio antes
 * de virar registro oficial.
 */
'use client'

import type { ReactNode } from 'react'

export interface CidSuggestionItem {
  code: string
  description: string
  confidence: number
  rationale: string
}

export interface CidSuggestionProps {
  cids: CidSuggestionItem[]
  targetConsultaId?: string | null
  /** Callback ao clicar "Adicionar" (caller invoca SA Sprint 20). Sem callback
   *  e sem targetConsultaId = render só pra leitura. */
  onAdd?: (cid: CidSuggestionItem) => void | Promise<void>
}

function confidenceColor(c: number): string {
  if (c >= 0.75) return 'var(--ev-success)'
  if (c >= 0.5) return 'var(--ev-warning)'
  return 'var(--ev-text-muted)'
}

export function CidSuggestion(props: CidSuggestionProps): ReactNode {
  const items = [...props.cids].sort((a, b) => b.confidence - a.confidence)

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
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-2)' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--ev-text-base)' }}>CIDs sugeridos</h3>
        <span style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
          apoio ao profissional — não é diagnóstico
        </span>
      </header>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--ev-space-2)' }}>
        {items.map((c) => (
          <li
            key={c.code}
            style={{
              padding: 'var(--ev-space-2)',
              borderLeft: `3px solid ${confidenceColor(c.confidence)}`,
              backgroundColor: 'var(--ev-surface-muted)',
              borderRadius: 'var(--ev-radius-sm)',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 'var(--ev-space-2)',
              alignItems: 'start',
            }}
          >
            <div>
              <div>
                <code style={{ fontWeight: 'var(--ev-weight-semibold)' }}>{c.code}</code>{' '}
                <span>{c.description}</span>
              </div>
              <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)', marginTop: 2 }}>
                {c.rationale}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <span
                style={{
                  fontSize: 'var(--ev-text-xs)',
                  color: confidenceColor(c.confidence),
                  fontWeight: 'var(--ev-weight-medium)',
                }}
              >
                {(c.confidence * 100).toFixed(0)}%
              </span>
              {props.onAdd && props.targetConsultaId ? (
                <button
                  type="button"
                  onClick={() => {
                    void props.onAdd?.(c)
                  }}
                  style={{
                    padding: '2px var(--ev-space-2)',
                    fontSize: 'var(--ev-text-xs)',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--ev-border-strong)',
                    borderRadius: 'var(--ev-radius-sm)',
                    cursor: 'pointer',
                    color: 'var(--ev-text)',
                  }}
                >
                  + Adicionar
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
