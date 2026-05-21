'use client'

/**
 * Client island for copy-link + WhatsApp share buttons em cada row da
 * lista de invites (Sprint 02b9).
 *
 * - Copy: usa navigator.clipboard; toast inline via state local
 * - WhatsApp: link `wa.me` abre app/web direto (sem JS necessário,
 *   mas mantido aqui pra consistência visual com o botão Copy)
 *
 * Mantido pequeno por design — componente "ações por row" só recebe
 * o que precisa (inviteUrl + whatsappShareUrl opcional). Sem chamada
 * server-side, sem fetch — UI puro.
 */
import { useRef, useState } from 'react'

interface Props {
  inviteUrl: string
  whatsappShareUrl: string | null
  compact?: boolean
}

type CopyState = 'idle' | 'copied' | 'manual'

export function InviteRowActions({ inviteUrl, whatsappShareUrl, compact = false }: Props) {
  const [state, setState] = useState<CopyState>('idle')
  const fallbackInputRef = useRef<HTMLInputElement>(null)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setState('copied')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      // Clipboard API unavailable (insecure context / permission denied) —
      // degrade gracefully: expor input read-only abaixo pro user selecionar
      // manualmente. Sem window.prompt (regra 45) nem toast (catálogo precisa
      // do MessageHost montado e este componente roda em ilha solta).
      setState('manual')
      setTimeout(() => fallbackInputRef.current?.select(), 0)
    }
  }

  const btnBase = compact
    ? 'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium'
    : 'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className={btnBase}
          style={{
            borderColor: 'var(--ev-border)',
            background: state === 'copied' ? 'var(--ev-success-bg)' : 'var(--ev-surface)',
            color: state === 'copied' ? 'var(--ev-success-fg)' : 'var(--ev-text)',
          }}
          aria-label="Copiar link do convite"
        >
          {state === 'copied' ? 'Copiado ✓' : 'Copiar link'}
        </button>

        {whatsappShareUrl && (
          <a
            href={whatsappShareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={btnBase}
            style={{
              // design-token-exempt: verde WhatsApp brand é exigência identidade visual
              borderColor: '#25D366',
              // design-token-exempt: verde WhatsApp brand é exigência identidade visual
              background: '#25D366',
              color: 'white',
            }}
            aria-label="Compartilhar convite via WhatsApp"
          >
            WhatsApp
          </a>
        )}
      </div>

      {state === 'manual' && (
        <div className="flex items-center gap-2">
          <input
            ref={fallbackInputRef}
            type="text"
            value={inviteUrl}
            readOnly
            aria-label="Link do convite (selecione para copiar)"
            className="flex-1 min-w-0 rounded-md border px-2 py-1 text-xs"
            style={{
              borderColor: 'var(--ev-border)',
              background: 'var(--ev-bg)',
              color: 'var(--ev-text)',
            }}
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
            selecione e copie
          </span>
        </div>
      )}
    </div>
  )
}
