'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createSupplier } from '../actions'

interface PersonOption {
  id: string
  name: string
  document: string | null
  kind: 'pf' | 'pj'
  email: string | null
}

export function NewSupplierForm({ persons }: { persons: PersonOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [personId, setPersonId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [termDays, setTermDays] = useState('')
  const [pixKey, setPixKey] = useState('')
  const [bank, setBank] = useState('')
  const [agency, setAgency] = useState('')
  const [account, setAccount] = useState('')
  const [notes, setNotes] = useState('')
  const [query, setQuery] = useState('')

  const filtered = query
    ? persons.filter(
        (p) =>
          p.name.toLowerCase().includes(query.toLowerCase()) || (p.document ?? '').includes(query),
      )
    : persons

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!personId) {
      setError('Selecione uma pessoa')
      return
    }
    startTransition(async () => {
      const bankAccount =
        pixKey || bank || agency || account
          ? {
              pixKey: pixKey || undefined,
              bank: bank || undefined,
              agency: agency || undefined,
              account: account || undefined,
            }
          : undefined
      const result = await createSupplier({
        personId,
        defaultPaymentMethod: (paymentMethod || undefined) as
          | 'pix'
          | 'ted'
          | 'doc'
          | 'boleto'
          | 'cash'
          | 'credit_card'
          | 'manual_other'
          | undefined,
        defaultPaymentTermDays: termDays ? Number(termDays) : undefined,
        bankAccount,
        notes: notes || undefined,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push('/app/financeiro/fornecedores')
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={submit}
      className="ev-card"
      style={{
        padding: 'var(--ev-space-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ev-space-md)',
        maxWidth: 720,
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Buscar pessoa</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nome ou CPF/CNPJ"
          className="ev-input"
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Pessoa</span>
        <select
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
          className="ev-input"
          required
          size={Math.min(filtered.length + 1, 8)}
        >
          <option value="">(escolha)</option>
          {filtered.map((p) => (
            <option key={p.id} value={p.id}>
              {p.kind.toUpperCase()} · {p.name}
              {p.document ? ` · ${p.document}` : ''}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Método de pagamento padrão</span>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="ev-input"
          >
            <option value="">(não definido)</option>
            <option value="pix">PIX</option>
            <option value="ted">TED</option>
            <option value="doc">DOC</option>
            <option value="boleto">Boleto</option>
            <option value="cash">Dinheiro</option>
            <option value="credit_card">Cartão</option>
            <option value="manual_other">Outro manual</option>
          </select>
        </label>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Prazo padrão (dias)</span>
          <input
            type="number"
            min={0}
            max={365}
            value={termDays}
            onChange={(e) => setTermDays(e.target.value)}
            className="ev-input"
            placeholder="30"
          />
        </label>
      </div>

      <fieldset
        style={{
          border: '1px solid var(--ev-border)',
          padding: 'var(--ev-space-md)',
          borderRadius: 'var(--ev-radius)',
        }}
      >
        <legend style={{ padding: '0 8px', fontSize: 'var(--ev-font-sm)' }}>
          Dados bancários (opcional)
        </legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-sm)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Chave PIX</span>
            <input
              type="text"
              value={pixKey}
              onChange={(e) => setPixKey(e.target.value)}
              className="ev-input"
              placeholder="CPF / CNPJ / e-mail / aleatória"
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Banco</span>
              <input
                type="text"
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                className="ev-input"
              />
            </label>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Agência</span>
              <input
                type="text"
                value={agency}
                onChange={(e) => setAgency(e.target.value)}
                className="ev-input"
              />
            </label>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Conta</span>
              <input
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="ev-input"
              />
            </label>
          </div>
        </div>
      </fieldset>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Notas (opcional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="ev-input"
          rows={2}
        />
      </label>

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}

      <div>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Salvando…' : 'Adicionar fornecedor'}
        </button>
      </div>
    </form>
  )
}
