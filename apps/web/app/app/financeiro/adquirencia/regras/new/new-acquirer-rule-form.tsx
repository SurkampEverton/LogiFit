'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createAcquirerReconciliationRule } from '../../actions'

function parseBrlToCents(v: string): number | undefined {
  if (!v) return undefined
  const cleaned = v
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return undefined
  return Math.round(num * 100)
}

export function NewAcquirerRuleForm({
  bankAccounts,
}: {
  bankAccounts: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [action, setAction] = useState<'auto_match_bank' | 'flag_for_review'>('auto_match_bank')
  const [priority, setPriority] = useState(100)
  const [targetBankAccountId, setTargetBankAccountId] = useState('')

  // Condições
  const [providerEquals, setProviderEquals] = useState('')
  const [cardBrandEquals, setCardBrandEquals] = useState('')
  const [cardKindEquals, setCardKindEquals] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [daysAfterSettlementMax, setDaysAfterSettlementMax] = useState('')
  const [bankDescriptionContains, setBankDescriptionContains] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Nome obrigatório')

    const condition: Record<string, unknown> = {}
    if (providerEquals) condition.providerEquals = providerEquals
    if (cardBrandEquals.trim()) condition.cardBrandEquals = cardBrandEquals.trim()
    if (cardKindEquals) condition.cardKindEquals = cardKindEquals
    const minC = parseBrlToCents(amountMin)
    if (minC != null) condition.amountMinCents = minC
    const maxC = parseBrlToCents(amountMax)
    if (maxC != null) condition.amountMaxCents = maxC
    const dMax = Number(daysAfterSettlementMax)
    if (Number.isFinite(dMax) && dMax > 0) condition.daysAfterSettlementMax = Math.floor(dMax)
    if (bankDescriptionContains.trim())
      condition.bankDescriptionContains = bankDescriptionContains.trim()

    if (Object.keys(condition).length === 0) return setError('Defina ao menos uma condição')

    startTransition(async () => {
      const r = await createAcquirerReconciliationRule({
        name: name.trim(),
        condition,
        action,
        priority,
        targetBankAccountId: targetBankAccountId || null,
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.push('/app/financeiro/adquirencia/regras')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Nome</span>
        <input
          className="ev-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Stone → Bradesco PJ"
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ev-space-md)' }}>
        <label className="ev-stack" style={{ gap: 4 }}>
          <span>Ação</span>
          <select
            className="ev-input"
            value={action}
            onChange={(e) => setAction(e.target.value as typeof action)}
          >
            <option value="auto_match_bank">🤖 Auto-conciliar com banco</option>
            <option value="flag_for_review">🚩 Sinalizar para revisão</option>
          </select>
        </label>
        <label className="ev-stack" style={{ gap: 4 }}>
          <span>Prioridade (menor = mais específica)</span>
          <input
            className="ev-input"
            type="number"
            min={1}
            max={1000}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </label>
      </div>

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Conta bancária alvo (opcional — restringe match)</span>
        <select
          className="ev-input"
          value={targetBankAccountId}
          onChange={(e) => setTargetBankAccountId(e.target.value)}
        >
          <option value="">— qualquer —</option>
          {bankAccounts.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <h3 style={{ marginBottom: 0 }}>Condições</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ev-space-md)' }}>
        <label className="ev-stack" style={{ gap: 4 }}>
          <span>Provider equals</span>
          <select
            className="ev-input"
            value={providerEquals}
            onChange={(e) => setProviderEquals(e.target.value)}
          >
            <option value="">— qualquer —</option>
            <option value="cielo">Cielo</option>
            <option value="stone">Stone</option>
            <option value="rede">Rede</option>
            <option value="getnet">GetNet</option>
            <option value="pagseguro">PagSeguro</option>
            <option value="mock">Mock</option>
          </select>
        </label>
        <label className="ev-stack" style={{ gap: 4 }}>
          <span>Bandeira equals</span>
          <input
            className="ev-input"
            value={cardBrandEquals}
            onChange={(e) => setCardBrandEquals(e.target.value)}
            placeholder="visa / master / elo / amex"
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ev-space-md)' }}>
        <label className="ev-stack" style={{ gap: 4 }}>
          <span>Tipo cartão equals</span>
          <select
            className="ev-input"
            value={cardKindEquals}
            onChange={(e) => setCardKindEquals(e.target.value)}
          >
            <option value="">— qualquer —</option>
            <option value="credit">Crédito</option>
            <option value="debit">Débito</option>
            <option value="voucher">Voucher (VR/VA)</option>
            <option value="pix">PIX</option>
            <option value="other">Outro</option>
          </select>
        </label>
        <label className="ev-stack" style={{ gap: 4 }}>
          <span>Dias após settlement (max)</span>
          <input
            className="ev-input"
            type="number"
            min={0}
            max={30}
            value={daysAfterSettlementMax}
            onChange={(e) => setDaysAfterSettlementMax(e.target.value)}
            placeholder="2"
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--ev-space-md)' }}>
        <label className="ev-stack" style={{ gap: 4 }}>
          <span>Valor mínimo (R$)</span>
          <input
            className="ev-input"
            value={amountMin}
            onChange={(e) => setAmountMin(e.target.value)}
            placeholder="100,00"
          />
        </label>
        <label className="ev-stack" style={{ gap: 4 }}>
          <span>Valor máximo (R$)</span>
          <input
            className="ev-input"
            value={amountMax}
            onChange={(e) => setAmountMax(e.target.value)}
            placeholder="5.000,00"
          />
        </label>
      </div>

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Descrição do banco contém</span>
        <input
          className="ev-input"
          value={bankDescriptionContains}
          onChange={(e) => setBankDescriptionContains(e.target.value)}
          placeholder="STONE LIQUIDACAO / CIELO PAG / etc"
        />
      </label>

      {error && (
        <div className="ev-banner ev-banner-danger" role="alert">
          {error}
        </div>
      )}

      <div>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Salvando...' : 'Criar regra'}
        </button>
      </div>
    </form>
  )
}
