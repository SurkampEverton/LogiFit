'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createCostCategory } from '../actions'

export function NewCategoryForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    const fd = new FormData(e.currentTarget)
    const slug = String(fd.get('slug') ?? '').trim()
    const name = String(fd.get('name') ?? '').trim()
    const type = String(fd.get('type')) as 'fixed' | 'variable'
    const icon = String(fd.get('icon') ?? '').trim()
    const description = String(fd.get('description') ?? '').trim()

    if (!slug || !name) {
      setError('Slug e nome obrigatórios')
      return
    }
    if (!/^[a-z0-9_]+$/.test(slug)) {
      setError('Slug aceita só letras minúsculas, números e underscore')
      return
    }

    startTransition(async () => {
      const result = await createCostCategory({
        slug,
        name,
        type,
        icon: icon || undefined,
        description: description || undefined,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setSuccess(true)
      ;(e.target as HTMLFormElement).reset()
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3 h-fit"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
        Nova categoria
      </h2>
      {error && (
        <div
          role="alert"
          className="rounded-md border p-2 text-xs"
          style={{
            borderColor: 'var(--ev-danger, #ef4444)',
            color: 'var(--ev-danger, #ef4444)',
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          className="rounded-md border p-2 text-xs"
          style={{
            borderColor: 'var(--ev-success, #22c55e)',
            color: 'var(--ev-success, #22c55e)',
          }}
        >
          ✓ Criada
        </div>
      )}

      <label className="space-y-1 text-sm block">
        <span className="block font-medium">Slug *</span>
        <input
          name="slug"
          type="text"
          required
          pattern="[a-z0-9_]+"
          placeholder="aluguel"
          className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-sm block">
        <span className="block font-medium">Nome *</span>
        <input
          name="name"
          type="text"
          required
          placeholder="Aluguel"
          className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-sm block">
        <span className="block font-medium">Tipo *</span>
        <select
          name="type"
          defaultValue="fixed"
          required
          className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2 text-sm"
        >
          <option value="fixed">Fixo</option>
          <option value="variable">Variável</option>
        </select>
      </label>
      <label className="space-y-1 text-sm block">
        <span className="block font-medium">Ícone (emoji)</span>
        <input
          name="icon"
          type="text"
          maxLength={2}
          placeholder="🏢"
          className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-sm block">
        <span className="block font-medium">Descrição</span>
        <textarea
          name="description"
          rows={2}
          className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2 text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Criando...' : 'Criar categoria'}
      </button>
    </form>
  )
}
