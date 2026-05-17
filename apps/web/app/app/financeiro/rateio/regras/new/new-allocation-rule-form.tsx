'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { createAllocationRule } from '../actions'

interface CompanyOption {
  id: string
  name: string
  type: string
}

type Kind = 'fixed' | 'proportional' | 'per_unit' | 'by_revenue' | 'by_headcount' | 'custom'

interface FixedItem {
  companyId: string
  percent: number
}
interface PropItem {
  companyId: string
  weight: number
}

export function NewAllocationRuleForm({ companies }: { companies: CompanyOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('fixed')
  const [description, setDescription] = useState('')

  // Estado da distribuição varia por kind
  const [fixedItems, setFixedItems] = useState<FixedItem[]>(() =>
    companies.slice(0, 3).map((c, i, arr) => ({
      companyId: c.id,
      percent: Number((100 / arr.length).toFixed(2)),
    })),
  )
  const [propItems, setPropItems] = useState<PropItem[]>(() =>
    companies.slice(0, 3).map((c) => ({ companyId: c.id, weight: 1 })),
  )
  const [simpleItems, setSimpleItems] = useState<string[]>(() =>
    companies.slice(0, 3).map((c) => c.id),
  )

  const sumPct = useMemo(() => fixedItems.reduce((s, i) => s + i.percent, 0), [fixedItems])
  const sumWeight = useMemo(() => propItems.reduce((s, i) => s + i.weight, 0), [propItems])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name) return setError('Nome obrigatório')

    let distribution: unknown
    if (kind === 'fixed' || kind === 'custom') {
      distribution = fixedItems.filter((i) => i.companyId)
      if (Math.abs(sumPct - 100) > 0.01) {
        return setError(`Soma deve ser 100%; atual ${sumPct.toFixed(2)}%`)
      }
    } else if (kind === 'proportional') {
      distribution = propItems.filter((i) => i.companyId && i.weight > 0)
      if (sumWeight <= 0) return setError('Soma dos pesos deve ser > 0')
    } else {
      distribution = simpleItems.filter((id) => id).map((id) => ({ companyId: id }))
    }

    startTransition(async () => {
      const r = await createAllocationRule({
        name,
        kind,
        distribution,
        description: description || undefined,
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.push('/app/financeiro/rateio/regras')
      router.refresh()
    })
  }

  function updateFixed(idx: number, patch: Partial<FixedItem>) {
    setFixedItems((arr) => arr.map((i, x) => (x === idx ? { ...i, ...patch } : i)))
  }
  function addFixed() {
    const used = new Set(fixedItems.map((i) => i.companyId))
    const next = companies.find((c) => !used.has(c.id))
    if (!next) return
    setFixedItems((arr) => [...arr, { companyId: next.id, percent: 0 }])
  }
  function removeFixed(idx: number) {
    setFixedItems((arr) => arr.filter((_, x) => x !== idx))
  }

  function updateProp(idx: number, patch: Partial<PropItem>) {
    setPropItems((arr) => arr.map((i, x) => (x === idx ? { ...i, ...patch } : i)))
  }
  function addProp() {
    const used = new Set(propItems.map((i) => i.companyId))
    const next = companies.find((c) => !used.has(c.id))
    if (!next) return
    setPropItems((arr) => [...arr, { companyId: next.id, weight: 1 }])
  }
  function removeProp(idx: number) {
    setPropItems((arr) => arr.filter((_, x) => x !== idx))
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
        maxWidth: 760,
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Nome da regra</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="ev-input"
          required
          maxLength={120}
          placeholder="Ex: Rateio aluguel matriz 40/30/30"
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Tipo (kind)</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="ev-input"
        >
          <option value="fixed">Fixo (% explícito; soma=100)</option>
          <option value="proportional">Proporcional (pesos relativos)</option>
          <option value="per_unit">Por unidade (snapshot das units)</option>
          <option value="by_revenue">Por receita (snapshot mês anterior)</option>
          <option value="by_headcount">Por headcount (snapshot users)</option>
          <option value="custom">Customizado (= fixed com soma=100)</option>
        </select>
      </label>

      {(kind === 'fixed' || kind === 'custom') && (
        <fieldset style={{ border: '1px solid var(--ev-border)', padding: 'var(--ev-space-md)' }}>
          <legend style={{ padding: '0 8px', fontSize: 'var(--ev-font-sm)' }}>
            Distribuição (soma deve ser 100%; atual:{' '}
            <strong style={{ color: Math.abs(sumPct - 100) < 0.01 ? 'var(--ev-success)' : 'var(--ev-danger)' }}>
              {sumPct.toFixed(2)}%
            </strong>
            )
          </legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-sm)' }}>
            {fixedItems.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 'var(--ev-space-sm)', alignItems: 'center' }}>
                <select
                  value={item.companyId}
                  onChange={(e) => updateFixed(idx, { companyId: e.target.value })}
                  className="ev-input"
                  style={{ flex: 2 }}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.type === 'matriz' ? '(matriz)' : ''}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={item.percent}
                  onChange={(e) => updateFixed(idx, { percent: Number(e.target.value) })}
                  className="ev-input"
                  style={{ width: 100 }}
                />
                <span>%</span>
                <button
                  type="button"
                  onClick={() => removeFixed(idx)}
                  className="ev-btn ev-btn-ghost"
                  disabled={fixedItems.length <= 1}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addFixed}
              className="ev-btn ev-btn-ghost"
              disabled={fixedItems.length >= companies.length || fixedItems.length >= 20}
            >
              + Adicionar company
            </button>
          </div>
        </fieldset>
      )}

      {kind === 'proportional' && (
        <fieldset style={{ border: '1px solid var(--ev-border)', padding: 'var(--ev-space-md)' }}>
          <legend style={{ padding: '0 8px', fontSize: 'var(--ev-font-sm)' }}>
            Pesos relativos (soma atual: {sumWeight})
          </legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-sm)' }}>
            {propItems.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 'var(--ev-space-sm)', alignItems: 'center' }}>
                <select
                  value={item.companyId}
                  onChange={(e) => updateProp(idx, { companyId: e.target.value })}
                  className="ev-input"
                  style={{ flex: 2 }}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={item.weight}
                  onChange={(e) => updateProp(idx, { weight: Number(e.target.value) })}
                  className="ev-input"
                  style={{ width: 100 }}
                />
                <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                  ≈ {((item.weight / Math.max(sumWeight, 1)) * 100).toFixed(1)}%
                </span>
                <button
                  type="button"
                  onClick={() => removeProp(idx)}
                  className="ev-btn ev-btn-ghost"
                  disabled={propItems.length <= 1}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addProp}
              className="ev-btn ev-btn-ghost"
              disabled={propItems.length >= companies.length || propItems.length >= 20}
            >
              + Adicionar company
            </button>
          </div>
        </fieldset>
      )}

      {(kind === 'per_unit' || kind === 'by_revenue' || kind === 'by_headcount') && (
        <fieldset style={{ border: '1px solid var(--ev-border)', padding: 'var(--ev-space-md)' }}>
          <legend style={{ padding: '0 8px', fontSize: 'var(--ev-font-sm)' }}>
            Companies elegíveis (pesos calculados em runtime via snapshot)
          </legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-sm)' }}>
            {companies.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={simpleItems.includes(c.id)}
                  onChange={(e) => {
                    if (e.target.checked) setSimpleItems((arr) => [...arr, c.id])
                    else setSimpleItems((arr) => arr.filter((x) => x !== c.id))
                  }}
                />
                <span>
                  {c.name} {c.type === 'matriz' ? '(matriz)' : ''}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Descrição (opcional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
          {pending ? 'Salvando…' : 'Criar regra'}
        </button>
      </div>
    </form>
  )
}
