'use client'

/**
 * Cadastro do token de **conta** Focus NFe da LogiFit (ADR 0105).
 *
 * Write-only: o token nunca volta do servidor. A tela mostra apenas se está
 * configurado, em qual ambiente e quando foi validado.
 */
import { toast } from '@repo/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { savePlatformFiscalToken } from './actions'

export function PlatformTokenForm({
  configured,
  currentEnvironment,
}: {
  configured: boolean
  currentEnvironment: string | null
}) {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [environment, setEnvironment] = useState(currentEnvironment ?? 'producao')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const r = await savePlatformFiscalToken({
        accountToken: token.trim(),
        environment: environment as 'homologacao' | 'producao',
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      setToken('') // some da memória do form assim que cumpre o papel
      // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
      toast.success('Token da conta Focus salvo e validado.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar token')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ev-stack" style={{ gap: 'var(--ev-space-sm)' }}>
      <p style={{ margin: 0, color: 'var(--ev-text-muted)' }}>
        Token da <strong>conta</strong> Focus da LogiFit — o que gerencia <code>/v2/empresas</code>.
        Não é o token de emissão de uma empresa. É usado para cadastrar empresas dos tenants e
        gravar credenciais de portal municipal quando o tenant não tem cadastro próprio.
      </p>

      <label htmlFor="pf-env">Ambiente</label>
      <select
        id="pf-env"
        className="ev-input"
        value={environment}
        onChange={(e) => setEnvironment(e.target.value)}
      >
        <option value="producao">produção</option>
        <option value="homologacao">homologação</option>
      </select>

      <label htmlFor="pf-token">
        Token da conta {configured ? '(preencha só para substituir o atual)' : ''}
      </label>
      <input
        id="pf-token"
        className="ev-input"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoComplete="off"
        required
      />

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending || !token.trim()}>
          {pending ? 'Validando…' : configured ? 'Substituir token' : 'Salvar token'}
        </button>
        {error && (
          <span role="alert" className="text-xs" style={{ color: 'var(--ev-danger, #dc2626)' }}>
            {error}
          </span>
        )}
      </div>
    </form>
  )
}
