'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { connectAcquirer } from '../actions'

interface Company {
  id: string
  name: string
}

interface BankAccountOption {
  id: string
  name: string
}

const PROVIDERS = [
  { key: 'mock', label: 'Mock (sandbox local — recomendado pra MVP)' },
  { key: 'stone', label: 'Stone' },
  { key: 'cielo', label: 'Cielo' },
  { key: 'rede', label: 'Rede (Itaú)' },
  { key: 'getnet', label: 'GetNet' },
  { key: 'pagseguro', label: 'PagSeguro' },
] as const

export function NewAcquirerConnectionForm({
  companies,
  bankAccounts,
}: {
  companies: Company[]
  bankAccounts: BankAccountOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]['key']>('mock')
  const [merchantId, setMerchantId] = useState('')
  const [nickname, setNickname] = useState('')
  const [settlementBankAccountId, setSettlementBankAccountId] = useState('')
  const [sandbox, setSandbox] = useState(true)
  const [apiKey, setApiKey] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!companyId) return setError('Selecione uma company')
    if (!merchantId.trim()) return setError('Merchant ID obrigatório')
    startTransition(async () => {
      const r = await connectAcquirer({
        companyId,
        provider,
        merchantId: merchantId.trim(),
        nickname: nickname.trim() || null,
        settlementBankAccountId: settlementBankAccountId || null,
        sandbox,
        credentials:
          provider === 'mock'
            ? { merchantId: merchantId.trim() }
            : apiKey.trim()
              ? { merchantId: merchantId.trim(), apiKey: apiKey.trim() }
              : undefined,
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.push('/app/financeiro/adquirencia')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Company</span>
        <select
          className="ev-input"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Provider</span>
        <select
          className="ev-input"
          value={provider}
          onChange={(e) => setProvider(e.target.value as typeof provider)}
        >
          {PROVIDERS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {provider !== 'mock' && (
          <small style={{ color: 'var(--ev-warning, #ca8a04)' }}>
            ⚠ Adapter real ainda não disponível — Sprint 18b implementa após POC. Mantenha
            sandbox=true; salvar com provider real falha por design no MVP.
          </small>
        )}
      </label>

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Merchant ID (PV / stoneCode / etc)</span>
        <input
          className="ev-input"
          value={merchantId}
          onChange={(e) => setMerchantId(e.target.value)}
          placeholder={provider === 'mock' ? 'MOCK-MERCHANT-001' : 'PV/stoneCode...'}
        />
      </label>

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Apelido (opcional)</span>
        <input
          className="ev-input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Stone Matriz"
        />
      </label>

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Conta bancária de settlement (opcional)</span>
        <select
          className="ev-input"
          value={settlementBankAccountId}
          onChange={(e) => setSettlementBankAccountId(e.target.value)}
        >
          <option value="">— Nenhuma —</option>
          {bankAccounts.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <small style={{ color: 'var(--ev-muted)' }}>
          Quando informada, conciliação automática busca settlement nesta conta primeiro.
        </small>
      </label>

      {provider !== 'mock' && (
        <label className="ev-stack" style={{ gap: 4 }}>
          <span>API Key (sandbox)</span>
          <input
            className="ev-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Chave sandbox do provider"
            autoComplete="off"
          />
          <small style={{ color: 'var(--ev-muted)' }}>
            Sprint 18b cifrará via envelope AES-256-GCM (ADR 0073). No MVP é em claro — use apenas
            sandbox.
          </small>
        </label>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
        <span>Sandbox (endpoint de teste)</span>
      </label>

      {error && (
        <div className="ev-banner ev-banner-danger" role="alert">
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--ev-space-sm)' }}>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Conectando...' : 'Conectar maquininha'}
        </button>
      </div>
    </form>
  )
}
