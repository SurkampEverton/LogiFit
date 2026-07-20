'use client'

import { GenUIMessage, type GenUIMessageBlockLike } from '@repo/ui/genui'
/**
 * Form + render da demo Generative UI — Sprint 28.
 *
 * Envia prompt via Server Action `composeGenUIResponse`; render dos blocos
 * retornados via `<GenUIMessage>` de @repo/ui/genui.
 */
import { useEffect, useState, useTransition } from 'react'
import { composeGenUIResponse } from '../genui-actions'

interface Props {
  initialPrompt?: string
}

interface State {
  loading: boolean
  blocks: GenUIMessageBlockLike[]
  err: string | null
  sessionId: string | null
}

export function GenUIDemoForm({ initialPrompt = '' }: Props) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [state, setState] = useState<State>({
    loading: false,
    blocks: [],
    err: null,
    sessionId: null,
  })
  const [pending, startTransition] = useTransition()

  async function submit(p: string) {
    if (!p.trim()) return
    setState((s) => ({ ...s, loading: true, err: null }))
    startTransition(async () => {
      try {
        const r = (await composeGenUIResponse({
          prompt: p,
          sessionId: state.sessionId,
          persona: 'professional_clinical',
        })) as
          | { ok: true; sessionId: string | null; blocks: GenUIMessageBlockLike[] }
          | { ok: false; error?: { message?: string } }
        if ('ok' in r && !r.ok) {
          setState((s) => ({ ...s, loading: false, err: r.error?.message ?? 'Falha' }))
          return
        }
        setState({
          loading: false,
          blocks: r.blocks,
          err: null,
          sessionId: r.sessionId,
        })
      } catch (e) {
        setState((s) => ({
          ...s,
          loading: false,
          err: e instanceof Error ? e.message : 'Erro inesperado',
        }))
      }
    })
  }

  // Auto-submit quando a URL traz `?q=`
  useEffect(() => {
    if (initialPrompt && initialPrompt.length > 1) {
      void submit(initialPrompt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void submit(prompt)
  }

  return (
    <div className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', gap: 'var(--ev-space-sm)', alignItems: 'stretch' }}
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ex: resumo do paciente, evolução da dor lombar..."
          style={{
            flex: 1,
            padding: 'var(--ev-space-2) var(--ev-space-3)',
            border: '1px solid var(--ev-border)',
            borderRadius: 'var(--ev-radius-md)',
            backgroundColor: 'var(--ev-surface)',
            color: 'var(--ev-text)',
            fontSize: 'var(--ev-text-base)',
            minHeight: 44,
          }}
        />
        <button
          type="submit"
          disabled={pending || state.loading || prompt.trim().length < 2}
          className="ev-btn ev-btn-primary"
        >
          {pending || state.loading ? '...' : 'Perguntar'}
        </button>
      </form>

      {state.err ? (
        <div
          style={{
            padding: 'var(--ev-space-3)',
            backgroundColor: 'var(--ev-danger-soft)',
            color: 'var(--ev-danger-hover)',
            borderRadius: 'var(--ev-radius-md)',
          }}
        >
          {state.err}
        </div>
      ) : null}

      {state.blocks.length > 0 ? (
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 'var(--ev-space-2)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 'var(--ev-text-lg)' }}>Resposta</h2>
            {state.sessionId ? (
              <code style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
                sessão {state.sessionId.slice(0, 8)}
              </code>
            ) : null}
          </header>
          <GenUIMessage blocks={state.blocks} />
        </section>
      ) : (
        !state.loading &&
        !pending && (
          <p style={{ color: 'var(--ev-text-muted)' }}>
            A resposta vai aparecer aqui — texto + componentes ricos.
          </p>
        )
      )}
    </div>
  )
}
