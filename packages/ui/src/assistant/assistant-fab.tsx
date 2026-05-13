'use client'

/**
 * `<AssistantFAB>` — botão flutuante global do assistente IA (ADR 0075).
 *
 * - Mobile (< 1024px): 56×56px bottom-right (1rem do bordo)
 * - Desktop (≥ 1024px): 64×64px bottom-right (1.5rem do bordo)
 * - Touch target ≥44px (regra 31)
 * - Atalho `Ctrl+/` ou `Cmd+/` (também em qualquer rota)
 * - Tokens "Equilíbrio Vital" (regra 44 + ADR 0016)
 *
 * Server passa `assistantName` (white-label) e `labels` (i18n).
 */
import { useEffect, useState } from 'react'
import { AssistantSheet } from './assistant-sheet'

export interface AssistantFABProps {
  /** Nome white-label (default 'Copilot'). */
  assistantName: string
  /** i18n flat labels — apenas chaves `assistant.*`. */
  labels: Record<string, string>
  /** ID de sessão ativa (Sprint 06+ Faixa D persiste em cookie); null = nova ao abrir. */
  initialSessionId?: string | null
  /** Persona ativa default — vem do server (inferPersona) ou cookie. */
  initialPersona: string
}

export function AssistantFAB({
  assistantName,
  labels,
  initialSessionId = null,
  initialPersona,
}: AssistantFABProps) {
  const [open, setOpen] = useState(false)

  // Atalho Ctrl/Cmd + / abre o sheet em qualquer rota
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const label = (key: string) => labels[key] ?? key

  return (
    <>
      <button
        type="button"
        aria-label={`${label('assistant.fab.open')} ${assistantName}`}
        aria-expanded={open}
        aria-controls="logifit-assistant-sheet"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'fixed',
          bottom: 'var(--ev-space-4, 1rem)',
          right: 'var(--ev-space-4, 1rem)',
          width: 'var(--ev-touch-min, 56px)',
          height: 'var(--ev-touch-min, 56px)',
          minWidth: '44px',
          minHeight: '44px',
          borderRadius: '9999px',
          backgroundColor: 'var(--ev-primary)',
          color: 'var(--ev-primary-foreground, white)',
          border: 'none',
          cursor: 'pointer',
          fontSize: 'var(--ev-text-2xl, 1.5rem)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 45,
          fontWeight: 700,
        }}
      >
        <span aria-hidden="true">✦</span>
      </button>

      {open && (
        <AssistantSheet
          assistantName={assistantName}
          labels={labels}
          initialSessionId={initialSessionId}
          initialPersona={initialPersona}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
