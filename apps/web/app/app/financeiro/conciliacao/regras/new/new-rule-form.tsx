'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createReconciliationRule } from '../actions'

function parseBrlToCents(value: string): number {
  if (!value) return 0
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100)
}

export function NewReconciliationRuleForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [action, setAction] = useState<
    'auto_match_ap' | 'auto_match_ar' | 'auto_create_entry' | 'flag_for_review'
  >('auto_match_ap')
  const [priority, setPriority] = useState(100)
  const [descriptionContains, setDescriptionContains] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [amountSign, setAmountSign] = useState<'negative' | 'positive' | 'any'>('any')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name) return setError('Nome obrigatório')
    const condition: Record<string, unknown> = {}
    if (descriptionContains) condition.descriptionContains = descriptionContains
    if (amountMin) condition.amountMinCents = parseBrlToCents(amountMin)
    if (amountMax) condition.amountMaxCents = parseBrlToCents(amountMax)
    if (amountSign !== 'any') condition.amountSign = amountSign
    if (Object.keys(condition).length === 0) return setError('Defina pelo menos uma condição')
    startTransition(async () => {
      const r = await createReconciliationRule({ name, condition, action, priority })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.push('/app/financeiro/conciliacao/regras')
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
        <span>Nome</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="ev-input"
          required
          maxLength={120}
          placeholder="Ex: Auto-match aluguel matriz"
        />
      </label>

      <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Ação</span>
          <select
            value={action}
            onChange={(e) =>
              setAction(
                e.target.value as
                  | 'auto_match_ap'
                  | 'auto_match_ar'
                  | 'auto_create_entry'
                  | 'flag_for_review',
              )
            }
            className="ev-input"
          >
            <option value="auto_match_ap">Auto-match AP (transação ↔ conta a pagar)</option>
            <option value="auto_match_ar">Auto-match AR (transação ↔ conta a receber)</option>
            <option value="auto_create_entry">Auto-criar cost entry (gasto eventual)</option>
            <option value="flag_for_review">Apenas sinalizar pra revisão</option>
          </select>
        </label>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Prioridade</span>
          <input
            type="number"
            min={1}
            max={9999}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="ev-input"
          />
          <small style={{ color: 'var(--ev-muted)' }}>
            Menor = mais específica = aplicada primeiro
          </small>
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
          Condições (todas combinadas com AND)
        </legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-sm)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Descrição contém</span>
            <input
              type="text"
              value={descriptionContains}
              onChange={(e) => setDescriptionContains(e.target.value)}
              className="ev-input"
              placeholder="Ex: aluguel, mensalidade, energia"
            />
          </label>

          <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Valor mínimo (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
                className="ev-input"
                placeholder="3.500,00"
              />
            </label>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Valor máximo (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                value={amountMax}
                onChange={(e) => setAmountMax(e.target.value)}
                className="ev-input"
                placeholder="4.500,00"
              />
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Sinal</span>
            <select
              value={amountSign}
              onChange={(e) =>
                setAmountSign(e.target.value as 'negative' | 'positive' | 'any')
              }
              className="ev-input"
            >
              <option value="any">Qualquer (entrada ou saída)</option>
              <option value="negative">Apenas saídas (negativos)</option>
              <option value="positive">Apenas entradas (positivos)</option>
            </select>
          </label>
        </div>
      </fieldset>

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}

      <div>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Salvando…' : 'Criar regra'}
        </button>
      </div>
    </form>
  )
}
