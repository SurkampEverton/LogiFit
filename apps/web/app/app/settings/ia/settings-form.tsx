'use client'

/**
 * Forms client-side de settings IA — Sprint 06 Faixa D real.
 *
 * - `<AssistantNameForm>` — edita white-label name
 * - `<ByokForm>` — adiciona/atualiza/testa/revoga key BYOK por provider
 *
 * Chama Server Actions diretamente; envelope `{ ok, data | error }` consumido
 * com toast (regra 45 + ADR 0089). Sem fetch manual.
 */
import { useState, useTransition } from 'react'
import {
  revokeByokKey,
  saveAssistantName,
  saveByokKey,
  testByokKey,
} from './actions'

interface ProviderListItem {
  slug: string
  name: string
  configured: boolean
  enabled: boolean
  lastTestedAt: string | null
  lastTestResult: string | null
}

export function AssistantNameForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName)
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    setError(null)
    startTransition(async () => {
      const result = await saveAssistantName({ assistantName: name })
      if (result.ok) {
        setMsg(`Nome atualizado: ${result.data.assistantName}`)
      } else {
        setError(result.error.message)
      }
    })
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-3)' }}>
      <label htmlFor="assistant-name" style={{ fontSize: 'var(--ev-text-sm)' }}>
        Nome do assistente
      </label>
      <input
        id="assistant-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        minLength={1}
        required
        disabled={pending}
        style={{
          padding: 'var(--ev-space-2)',
          borderRadius: 8,
          border: '1px solid var(--ev-border)',
          backgroundColor: 'var(--ev-input-bg, white)',
          color: 'var(--ev-text)',
          fontSize: 'var(--ev-text-sm)',
          fontFamily: 'inherit',
        }}
      />
      <button
        type="submit"
        disabled={pending || !name.trim()}
        style={{
          minHeight: 'var(--ev-touch-min, 44px)',
          padding: 'var(--ev-space-2) var(--ev-space-4)',
          borderRadius: 8,
          border: 'none',
          backgroundColor: 'var(--ev-primary)',
          color: 'white',
          cursor: pending || !name.trim() ? 'not-allowed' : 'pointer',
          opacity: pending || !name.trim() ? 0.6 : 1,
          fontSize: 'var(--ev-text-sm)',
          fontWeight: 600,
          alignSelf: 'flex-start',
        }}
      >
        {pending ? 'Salvando…' : 'Salvar'}
      </button>
      {msg && <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-success-text, #065f46)' }}>{msg}</div>}
      {error && <div role="alert" style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-danger-text, #991b1b)' }}>{error}</div>}
    </form>
  )
}

export function ByokForm({ providers }: { providers: ProviderListItem[] }) {
  const [selectedSlug, setSelectedSlug] = useState(providers[0]?.slug ?? '')
  const [apiKey, setApiKey] = useState('')
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [providersState, setProvidersState] = useState(providers)

  function setProviderState(slug: string, patch: Partial<ProviderListItem>) {
    setProvidersState((curr) =>
      curr.map((p) => (p.slug === slug ? { ...p, ...patch } : p)),
    )
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    setError(null)
    startTransition(async () => {
      const result = await saveByokKey({ providerSlug: selectedSlug as ProviderListItem['slug'] as 'vertex-ai-gemini', apiKey })
      if (result.ok) {
        setMsg(`Key salva para ${selectedSlug}`)
        setApiKey('')
        setProviderState(selectedSlug, { configured: true, enabled: true })
      } else {
        setError(result.error.message)
      }
    })
  }

  async function onTest(slug: string) {
    setMsg(null)
    setError(null)
    startTransition(async () => {
      const result = await testByokKey({ providerSlug: slug as 'vertex-ai-gemini' })
      if (result.ok) {
        setMsg(`Teste ${slug}: ${result.data.result}`)
        setProviderState(slug, {
          lastTestedAt: new Date().toISOString(),
          lastTestResult: result.data.result,
        })
      } else {
        setError(result.error.message)
      }
    })
  }

  async function onRevoke(slug: string) {
    setMsg(null)
    setError(null)
    startTransition(async () => {
      const result = await revokeByokKey({ providerSlug: slug as 'vertex-ai-gemini' })
      if (result.ok) {
        setMsg(`Key revogada para ${slug}`)
        setProviderState(slug, { enabled: false })
      } else {
        setError(result.error.message)
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-4)' }}>
      <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-2)' }}>
        <label htmlFor="byok-provider" style={{ fontSize: 'var(--ev-text-sm)' }}>
          Provider
        </label>
        <select
          id="byok-provider"
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          disabled={pending}
          style={{
            padding: 'var(--ev-space-2)',
            borderRadius: 8,
            border: '1px solid var(--ev-border)',
            backgroundColor: 'var(--ev-input-bg, white)',
            color: 'var(--ev-text)',
            fontSize: 'var(--ev-text-sm)',
          }}
        >
          {providers.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <label htmlFor="byok-api-key" style={{ fontSize: 'var(--ev-text-sm)' }}>
          API Key
        </label>
        <input
          id="byok-api-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          minLength={8}
          maxLength={512}
          autoComplete="off"
          required
          disabled={pending}
          placeholder="cole sua key — será cifrada AES-256-GCM"
          style={{
            padding: 'var(--ev-space-2)',
            borderRadius: 8,
            border: '1px solid var(--ev-border)',
            backgroundColor: 'var(--ev-input-bg, white)',
            color: 'var(--ev-text)',
            fontSize: 'var(--ev-text-sm)',
            fontFamily: 'monospace',
          }}
        />
        <button
          type="submit"
          disabled={pending || apiKey.length < 8}
          style={{
            minHeight: 'var(--ev-touch-min, 44px)',
            padding: 'var(--ev-space-2) var(--ev-space-4)',
            borderRadius: 8,
            border: 'none',
            backgroundColor: 'var(--ev-primary)',
            color: 'white',
            cursor: pending || apiKey.length < 8 ? 'not-allowed' : 'pointer',
            opacity: pending || apiKey.length < 8 ? 0.6 : 1,
            fontSize: 'var(--ev-text-sm)',
            fontWeight: 600,
            alignSelf: 'flex-start',
          }}
        >
          {pending ? 'Salvando…' : 'Salvar BYOK key'}
        </button>
      </form>

      {/* Lista status dos providers */}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--ev-space-2)' }}>
        {providersState.map((p) => (
          <li
            key={p.slug}
            style={{
              padding: 'var(--ev-space-3)',
              border: '1px solid var(--ev-border)',
              borderRadius: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--ev-space-2)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 'var(--ev-text-sm)' }}>{p.name}</strong>
              <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
                {p.configured
                  ? p.enabled
                    ? 'ativo'
                    : 'desabilitado'
                  : 'não configurado'}
                {p.lastTestedAt && p.lastTestResult && ` · último teste: ${p.lastTestResult}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--ev-space-1)' }}>
              {p.configured && (
                <button
                  type="button"
                  onClick={() => void onTest(p.slug)}
                  disabled={pending}
                  style={{
                    minHeight: 'var(--ev-touch-min, 44px)',
                    padding: '0 var(--ev-space-3)',
                    borderRadius: 6,
                    border: '1px solid var(--ev-border)',
                    backgroundColor: 'transparent',
                    cursor: pending ? 'wait' : 'pointer',
                    fontSize: 'var(--ev-text-xs)',
                  }}
                >
                  Testar
                </button>
              )}
              {p.configured && p.enabled && (
                <button
                  type="button"
                  onClick={() => void onRevoke(p.slug)}
                  disabled={pending}
                  style={{
                    minHeight: 'var(--ev-touch-min, 44px)',
                    padding: '0 var(--ev-space-3)',
                    borderRadius: 6,
                    border: '1px solid var(--ev-danger, #ef4444)',
                    backgroundColor: 'transparent',
                    color: 'var(--ev-danger-text, #991b1b)',
                    cursor: pending ? 'wait' : 'pointer',
                    fontSize: 'var(--ev-text-xs)',
                  }}
                >
                  Revogar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {msg && (
        <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-success-text, #065f46)' }}>{msg}</div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-danger-text, #991b1b)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
