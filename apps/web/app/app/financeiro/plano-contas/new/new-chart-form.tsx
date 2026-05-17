'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createChartAccount } from '../actions'

interface ParentOption {
  id: string
  code: string
  name: string
  kind: 'ativo' | 'passivo' | 'receita' | 'despesa' | 'custo'
}

export function NewChartAccountForm({ parentOptions }: { parentOptions: ParentOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<'ativo' | 'passivo' | 'receita' | 'despesa' | 'custo'>('despesa')
  const [parentId, setParentId] = useState<string>('')
  const [isLeaf, setIsLeaf] = useState(true)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const filteredParents = parentOptions.filter((p) => p.kind === kind)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!code || !name) {
      setError('Código e nome são obrigatórios')
      return
    }
    startTransition(async () => {
      const result = await createChartAccount({
        code,
        name,
        kind,
        parentId: parentId || null,
        isLeaf,
        description: description || undefined,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push('/app/financeiro/plano-contas')
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
        maxWidth: 640,
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Tipo (kind)</span>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind)
            setParentId('')
          }}
          className="ev-input"
        >
          <option value="ativo">Ativo</option>
          <option value="passivo">Passivo</option>
          <option value="receita">Receita</option>
          <option value="despesa">Despesa</option>
          <option value="custo">Custo</option>
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Conta pai (opcional)</span>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="ev-input"
        >
          <option value="">(raiz — sem pai)</option>
          {filteredParents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        {filteredParents.length === 0 && (
          <small style={{ color: 'var(--ev-muted)' }}>
            Nenhuma conta deste kind existe ainda — será criada como raiz.
          </small>
        )}
      </label>

      <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Código (ex: 4.2.10)</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="ev-input"
            pattern="^[0-9]+(\.[0-9]+)*$"
            placeholder="4.2.10"
            required
          />
        </label>
        <label style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Nome</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="ev-input"
            required
          />
        </label>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Descrição (opcional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="ev-input"
          rows={2}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={isLeaf} onChange={(e) => setIsLeaf(e.target.checked)} />
        <span>É folha (aceita lançamentos AP/AR)</span>
      </label>

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Criando…' : 'Criar conta'}
        </button>
      </div>
    </form>
  )
}
