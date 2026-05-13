'use client'

/**
 * `<AssistantSheet>` — bottom sheet mobile / side panel desktop (ADR 0075).
 *
 * - Mobile (< 1024px): bottom sheet 92vh
 * - Desktop (≥ 1024px): side panel 420px à direita
 * - Header: persona chip + assistantName + ✕
 * - Body: lista mensagens (rolagem) + ActionConfirmDialog
 * - Footer: input textarea + Enter envia + cota visível
 *
 * Comunicação: `POST /api/ai/chat` retorna mensagem assistente; props de
 * confirmação chamam `/api/ai/proposals/:id/(confirm|reject)`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  guardrailBlocked?: boolean
  at: number
}

export interface AssistantSheetProps {
  assistantName: string
  labels: Record<string, string>
  initialSessionId?: string | null
  initialPersona: string
  onClose: () => void
}

interface QuotaSnapshot {
  used: number
  limit: number
  percent: number
}

export function AssistantSheet({
  assistantName,
  labels,
  initialSessionId,
  initialPersona,
  onClose,
}: AssistantSheetProps) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null)
  const [persona] = useState<string>(initialPersona)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const label = (k: string) => labels[k] ?? k

  // Auto-scroll ao adicionar msg
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [])

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId
    // safe-fetch-exempt: same-origin client fetch to local /api/* (regra 37 é pra outbound externo)
    const res = await fetch('/api/ai/session', { method: 'POST', body: JSON.stringify({}) })
    const json = (await res.json()) as { ok: boolean; data?: { sessionId: string }; error?: { message: string } }
    if (!json.ok || !json.data?.sessionId) {
      throw new Error(json.error?.message ?? 'Falha ao criar sessão')
    }
    setSessionId(json.data.sessionId)
    return json.data.sessionId
  }, [sessionId])

  async function handleSend() {
    const trimmed = input.trim()
    if (!trimmed || busy) return
    setError(null)
    setBusy(true)

    try {
      const sid = await ensureSession()
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
        at: Date.now(),
      }
      setMessages((m) => [...m, userMsg])
      setInput('')

      // safe-fetch-exempt: same-origin client fetch to local /api/* (regra 37 é pra outbound externo)
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, message: trimmed }),
      })
      const json = (await res.json()) as {
        ok: boolean
        data?: { assistantMessage: string; guardrailBlocked: boolean; quota: QuotaSnapshot }
        error?: { code: string; message: string }
      }
      if (!json.ok) {
        setError(json.error?.message ?? 'Falha desconhecida')
        return
      }
      const aMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: json.data!.assistantMessage,
        guardrailBlocked: json.data!.guardrailBlocked,
        at: Date.now(),
      }
      setMessages((m) => [...m, aMsg])
      setQuota(json.data!.quota)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  const personaLabel = label(`assistant.persona.${persona}`)

  return (
    <div
      id="logifit-assistant-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-title"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
        backgroundColor: 'var(--ev-surface)',
        borderLeft: '1px solid var(--ev-border)',
        boxShadow: '-4px 0 12px rgba(0,0,0,0.08)',
        width: 'min(100vw, 420px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Backdrop pra mobile (full overlay) */}
      <button
        type="button"
        aria-label={label('assistant.close')}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'default',
          zIndex: -1,
        }}
      />

      {/* HEADER */}
      <header
        style={{
          padding: 'var(--ev-space-4)',
          borderBottom: '1px solid var(--ev-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--ev-space-3)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            backgroundColor: 'var(--ev-primary)',
            color: 'white',
            fontWeight: 700,
          }}
        >
          ✦
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            id="assistant-title"
            style={{
              margin: 0,
              fontSize: 'var(--ev-text-base)',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {assistantName}
          </h2>
          <span
            style={{
              fontSize: 'var(--ev-text-xs)',
              color: 'var(--ev-text-muted)',
            }}
          >
            {label('assistant.speaking_as')}: {personaLabel}
          </span>
        </div>
        <button
          type="button"
          aria-label={label('assistant.close')}
          onClick={onClose}
          style={{
            minWidth: 'var(--ev-touch-min, 44px)',
            minHeight: 'var(--ev-touch-min, 44px)',
            background: 'transparent',
            border: 'none',
            color: 'var(--ev-text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--ev-text-lg)',
          }}
        >
          ✕
        </button>
      </header>

      {/* QUOTA INDICATOR */}
      {quota && (
        <div
          style={{
            padding: 'var(--ev-space-2) var(--ev-space-4)',
            backgroundColor: quota.percent >= 80 ? 'var(--ev-warning-bg, #fbbf24)' : 'transparent',
            color: quota.percent >= 80 ? 'var(--ev-warning-text, #78350f)' : 'var(--ev-text-muted)',
            fontSize: 'var(--ev-text-xs)',
            borderBottom: '1px solid var(--ev-border)',
          }}
        >
          {label('assistant.quota.used')}: {quota.used} / {quota.limit} ({Math.round(quota.percent)}%)
        </div>
      )}

      {/* BODY — mensagens */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--ev-space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--ev-space-3)',
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              padding: 'var(--ev-space-4)',
              textAlign: 'center',
              color: 'var(--ev-text-muted)',
              fontSize: 'var(--ev-text-sm)',
            }}
          >
            {label('assistant.empty')}
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: 'var(--ev-space-3)',
              borderRadius: 12,
              backgroundColor:
                m.role === 'user'
                  ? 'var(--ev-primary)'
                  : m.guardrailBlocked
                    ? 'var(--ev-warning-bg, #fef3c7)'
                    : 'var(--ev-surface-muted)',
              color: m.role === 'user' ? 'white' : 'var(--ev-text)',
              fontSize: 'var(--ev-text-sm)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {m.content}
            {m.guardrailBlocked && (
              <div
                style={{
                  marginTop: 'var(--ev-space-2)',
                  fontSize: 'var(--ev-text-xs)',
                  fontStyle: 'italic',
                  color: 'var(--ev-text-muted)',
                }}
              >
                ⚠ {label('assistant.guardrail_notice')}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div
            style={{
              alignSelf: 'flex-start',
              color: 'var(--ev-text-muted)',
              fontSize: 'var(--ev-text-sm)',
              fontStyle: 'italic',
            }}
          >
            {label('assistant.thinking')}
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: 'var(--ev-space-3)',
            backgroundColor: 'var(--ev-danger-bg, #fee2e2)',
            color: 'var(--ev-danger-text, #991b1b)',
            fontSize: 'var(--ev-text-sm)',
            borderTop: '1px solid var(--ev-border)',
          }}
        >
          {error}
        </div>
      )}

      {/* FOOTER — input */}
      <div
        style={{
          padding: 'var(--ev-space-3)',
          borderTop: '1px solid var(--ev-border)',
          display: 'flex',
          gap: 'var(--ev-space-2)',
          alignItems: 'flex-end',
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={label('assistant.input.placeholder')}
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            padding: 'var(--ev-space-2)',
            borderRadius: 8,
            border: '1px solid var(--ev-border)',
            backgroundColor: 'var(--ev-input-bg, white)',
            color: 'var(--ev-text)',
            fontSize: 'var(--ev-text-sm)',
            fontFamily: 'inherit',
          }}
          disabled={busy}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={busy || !input.trim()}
          style={{
            minHeight: 'var(--ev-touch-min, 44px)',
            padding: 'var(--ev-space-2) var(--ev-space-4)',
            borderRadius: 8,
            border: 'none',
            backgroundColor: 'var(--ev-primary)',
            color: 'white',
            cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !input.trim() ? 0.5 : 1,
            fontSize: 'var(--ev-text-sm)',
            fontWeight: 600,
          }}
        >
          {label('assistant.send')}
        </button>
      </div>

      {/* DISCLAIMER fixo (regra 28) */}
      <div
        style={{
          padding: 'var(--ev-space-2) var(--ev-space-3)',
          borderTop: '1px solid var(--ev-border)',
          fontSize: 'var(--ev-text-xs)',
          color: 'var(--ev-text-muted)',
          textAlign: 'center',
        }}
      >
        {label('assistant.disclaimer')}
      </div>
    </div>
  )
}
