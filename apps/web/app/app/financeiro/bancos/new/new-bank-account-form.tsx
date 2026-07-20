'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createBankAccount } from '../actions'

interface Company {
  id: string
  name: string
}

const COMMON_BANKS = [
  { code: '001', name: 'Banco do Brasil' },
  { code: '033', name: 'Santander' },
  { code: '104', name: 'Caixa Econômica Federal' },
  { code: '237', name: 'Bradesco' },
  { code: '341', name: 'Itaú' },
  { code: '260', name: 'Nubank' },
  { code: '077', name: 'Inter' },
  { code: '212', name: 'Banco Original' },
  { code: '290', name: 'PagSeguro' },
  { code: '380', name: 'PicPay' },
  { code: '336', name: 'C6 Bank' },
  { code: '748', name: 'Sicredi' },
  { code: '756', name: 'Sicoob' },
]

function parseBrlToCents(value: string): number {
  if (!value) return 0
  const cleaned = value
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100)
}

export function NewBankAccountForm({ companies }: { companies: Company[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [bankCode, setBankCode] = useState('237')
  const [bankName, setBankName] = useState('Bradesco')
  const [agency, setAgency] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountDigit, setAccountDigit] = useState('')
  const [kind, setKind] = useState<'checking' | 'savings' | 'business' | 'cashbox'>('business')
  const [openingBalance, setOpeningBalance] = useState('')
  const [nickname, setNickname] = useState('')

  function handleBankSelect(code: string) {
    const bank = COMMON_BANKS.find((b) => b.code === code)
    setBankCode(code)
    if (bank) setBankName(bank.name)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!companyId) return setError('Company obrigatória')
    if (!bankCode || !bankName || !accountNumber) return setError('Banco e conta obrigatórios')
    startTransition(async () => {
      const r = await createBankAccount({
        companyId,
        bankCode,
        bankName,
        agency: agency || null,
        accountNumber,
        accountDigit: accountDigit || null,
        kind,
        openingBalanceCents: parseBrlToCents(openingBalance),
        nickname: nickname || null,
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.push('/app/financeiro/bancos')
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
        <span>Company</span>
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="ev-input"
          required
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Banco</span>
          <select
            value={bankCode}
            onChange={(e) => handleBankSelect(e.target.value)}
            className="ev-input"
            required
          >
            {COMMON_BANKS.map((b) => (
              <option key={b.code} value={b.code}>
                {b.code} — {b.name}
              </option>
            ))}
            <option value="">Outro…</option>
          </select>
        </label>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Tipo</span>
          <select
            value={kind}
            onChange={(e) =>
              setKind(e.target.value as 'checking' | 'savings' | 'business' | 'cashbox')
            }
            className="ev-input"
          >
            <option value="business">CC Pessoa Jurídica</option>
            <option value="checking">CC Pessoa Física</option>
            <option value="savings">Poupança</option>
            <option value="cashbox">Caixa físico</option>
          </select>
        </label>
      </div>

      {!COMMON_BANKS.find((b) => b.code === bankCode) && (
        <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Código do banco</span>
            <input
              type="text"
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value)}
              className="ev-input"
              maxLength={10}
            />
          </label>
          <label style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Nome do banco</span>
            <input
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="ev-input"
              maxLength={120}
            />
          </label>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Agência</span>
          <input
            type="text"
            value={agency}
            onChange={(e) => setAgency(e.target.value)}
            className="ev-input"
            maxLength={20}
          />
        </label>
        <label style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Conta</span>
          <input
            type="text"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            className="ev-input"
            maxLength={30}
            required
          />
        </label>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Dígito</span>
          <input
            type="text"
            value={accountDigit}
            onChange={(e) => setAccountDigit(e.target.value)}
            className="ev-input"
            maxLength={4}
          />
        </label>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Apelido (opcional)</span>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="ev-input"
          placeholder="Ex: Bradesco Matriz CC"
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Saldo inicial (R$)</span>
        <input
          type="text"
          inputMode="decimal"
          value={openingBalance}
          onChange={(e) => setOpeningBalance(e.target.value)}
          className="ev-input"
          placeholder="0,00"
        />
        <small style={{ color: 'var(--ev-muted)' }}>
          Saldo conhecido no momento do cadastro. Importe OFX depois pra preencher transações
          retroativas.
        </small>
      </label>

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}

      <div>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Salvando…' : 'Criar conta'}
        </button>
      </div>
    </form>
  )
}
