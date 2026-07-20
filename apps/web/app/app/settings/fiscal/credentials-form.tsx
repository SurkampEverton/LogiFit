'use client'

/**
 * Form de credenciais Focus NFe — Sprint 36b (Step 1 do wizard).
 *
 * Token é write-only: o form nunca recebe o valor atual de volta — placeholder
 * indica "configurado" e salvar sobrescreve. Webhook secret é gerado no client
 * (crypto.getRandomValues) e exibido UMA vez pro admin registrar a URL no Focus.
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { saveFiscalCredentials, validateFiscalCredentials } from './actions'

function generateWebhookSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function FiscalCredentialsForm({ configured }: { configured: boolean }) {
  const router = useRouter()
  const [apiToken, setApiToken] = useState('')
  const [environment, setEnvironment] = useState<'homologacao' | 'producao'>('homologacao')
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null)
  // Cadastro próprio: tenant tem conta na Focus e informa o token de CONTA.
  // Desligado, usa a conta da plataforma (ADR 0105).
  const [ownAccount, setOwnAccount] = useState(false)
  const [accountToken, setAccountToken] = useState('')
  const [pending, setPending] = useState<'save' | 'validate' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [validation, setValidation] = useState<string | null>(null)

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    if (!apiToken) return
    setPending('save')
    setError(null)
    try {
      const secret = webhookSecret ?? generateWebhookSecret()
      const r = await saveFiscalCredentials({
        apiToken,
        environment,
        webhookSecret: secret,
        ownAccount,
        accountToken: ownAccount ? accountToken.trim() : undefined,
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      setWebhookSecret(secret)
      setApiToken('')
      setAccountToken('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar credenciais')
    } finally {
      setPending(null)
    }
  }

  async function handleValidate() {
    setPending('validate')
    setError(null)
    setValidation(null)
    try {
      const r = await validateFiscalCredentials({})
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      setValidation(
        r.data.ok
          ? `✓ Credenciais válidas (${r.data.latencyMs}ms)`
          : `✗ Falhou: ${r.data.message ?? 'erro desconhecido'}`,
      )
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao validar')
    } finally {
      setPending(null)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-3" style={{ maxWidth: '28rem' }}>
      <div className="space-y-1">
        <label htmlFor="fiscal-api-token" className="text-sm font-medium">
          API token Focus NFe
        </label>
        <input
          id="fiscal-api-token"
          type="password"
          className="ev-input w-full"
          autoComplete="off"
          placeholder={configured ? 'Configurado — digite pra substituir' : 'Token da conta Focus'}
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="fiscal-environment" className="text-sm font-medium">
          Ambiente
        </label>
        <select
          id="fiscal-environment"
          className="ev-input w-full"
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as 'homologacao' | 'producao')}
        >
          <option value="homologacao">Homologação (sandbox — sem valor fiscal)</option>
          <option value="producao">Produção (emite notas reais)</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm font-medium" htmlFor="fiscal-own-account">
          <input
            id="fiscal-own-account"
            type="checkbox"
            checked={ownAccount}
            onChange={(e) => setOwnAccount(e.target.checked)}
          />
          Cadastro próprio na Focus NFe
        </label>
        <p className="text-xs" style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
          Marque se esta empresa tem <strong>conta própria</strong> na Focus. Desmarcado, o cadastro
          de empresas e as credenciais de portal municipal usam a conta da LogiFit.
        </p>
      </div>

      {ownAccount && (
        <div className="space-y-1">
          <label htmlFor="fiscal-account-token" className="text-sm font-medium">
            Token da conta Focus
          </label>
          <input
            id="fiscal-account-token"
            className="ev-input w-full"
            type="password"
            value={accountToken}
            onChange={(e) => setAccountToken(e.target.value)}
            autoComplete="off"
          />
          <p className="text-xs" style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
            É o token que <strong>gerencia empresas</strong> no painel da Focus — diferente do token
            de emissão acima.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending !== null || !apiToken}
          className="ev-btn ev-btn-primary"
          style={{ fontSize: '0.85rem' }}
        >
          {pending === 'save' ? 'Salvando…' : 'Salvar credenciais'}
        </button>
        {configured && (
          <button
            type="button"
            onClick={handleValidate}
            disabled={pending !== null}
            className="ev-btn"
            style={{ fontSize: '0.85rem' }}
          >
            {pending === 'validate' ? 'Validando…' : '⚡ Testar conexão'}
          </button>
        )}
      </div>

      {webhookSecret && (
        <div
          className="rounded-md border p-3 text-sm space-y-1"
          style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
        >
          <p className="font-medium">Webhook registrado — anote o secret (exibido só agora):</p>
          <code className="block break-all text-xs">{webhookSecret}</code>
          <p className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
            URL pra cadastrar no painel Focus NFe:{' '}
            <code className="break-all">
              {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/fiscal/focus-nfe/callback?token=${webhookSecret}`}
            </code>
          </p>
        </div>
      )}

      {validation && <p className="text-sm">{validation}</p>}
      {error && (
        <p className="text-xs" role="alert" style={{ color: 'var(--ev-danger, #dc2626)' }}>
          {error}
        </p>
      )}
    </form>
  )
}
