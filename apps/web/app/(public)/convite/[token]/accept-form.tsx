'use client'

/**
 * Form de aceite de convite — Sprint 01c (ADR 0103).
 *
 * Aceite NÃO cria sessão: sucesso direciona pro /login (magic link).
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function AcceptInviteForm({
  token,
  email,
  suggestedName,
}: {
  token: string
  email: string
  suggestedName: string
}) {
  const router = useRouter()
  const [name, setName] = useState(suggestedName)
  const [document, setDocument] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      // safe-fetch-exempt: rota same-origin do próprio app (path relativo, sem host) — safeFetch existe pra SSRF em URL externa
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, name: name.trim(), document: document.trim() || undefined }),
      })
      const body = await res.json()
      if (!body.ok) throw new Error(body.error?.message ?? 'Falha ao aceitar convite')
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao aceitar convite')
    } finally {
      setPending(false)
    }
  }

  if (done) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: <output> tem semântica de resultado de cálculo em form; aqui é confirmação de fluxo concluído
      <div className="ev-stack" role="status">
        <p>
          Acesso criado para <strong>{email}</strong>. Entre pelo login — enviaremos um link mágico
          para esse email. No primeiro acesso você configurará a autenticação em duas etapas.
        </p>
        <button
          type="button"
          className="ev-btn ev-btn-primary"
          onClick={() => router.push('/login')}
        >
          Ir para o login
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="ev-stack">
      <div className="ev-stack-sm">
        <label htmlFor="accept-name" className="text-sm font-medium">
          Seu nome completo
        </label>
        <input
          id="accept-name"
          className="ev-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
      </div>
      <div className="ev-stack-sm">
        <label htmlFor="accept-document" className="text-sm font-medium">
          CPF ou CNPJ (opcional)
        </label>
        <input
          id="accept-document"
          className="ev-input"
          placeholder="000.000.000-00"
          value={document}
          onChange={(e) => setDocument(e.target.value)}
        />
      </div>
      <button type="submit" className="ev-btn ev-btn-primary" disabled={pending || name.length < 2}>
        {pending ? 'Criando acesso…' : 'Aceitar convite'}
      </button>
      {error && (
        <p className="text-xs" role="alert" style={{ color: 'var(--ev-danger, #dc2626)' }}>
          {error}
        </p>
      )}
    </form>
  )
}
