'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createAssessmentType } from '../../actions'

interface FieldDraft {
  key: string
  label: string
  kind: 'number' | 'text' | 'enum' | 'likert'
  unit: string
  min: string
  max: string
  options: string
}

const newField = (): FieldDraft => ({
  key: '',
  label: '',
  kind: 'number',
  unit: '',
  min: '',
  max: '',
  options: '',
})

export function NewAssessmentTypeForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldDraft[]>([newField()])

  function updateField(idx: number, patch: Partial<FieldDraft>) {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }
  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx))
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const name = String(fd.get('name') ?? '').trim()
    const category = String(fd.get('category')) as
      | 'composicao_corporal'
      | 'escala_funcional'
      | 'anamnese'
      | 'teste_funcional'
      | 'custom'
    const vertical = String(fd.get('vertical') ?? '') as 'academia' | 'fisio' | 'nutri' | ''

    if (!name || fields.length === 0) {
      setError('Nome e ao menos 1 campo obrigatórios')
      return
    }

    const fieldsParsed = fields
      .map((f) => {
        if (!f.key || !f.label) return null
        const def: Record<string, unknown> = {
          key: f.key.trim(),
          label: f.label.trim(),
          kind: f.kind,
        }
        if (f.unit) def.unit = f.unit
        if (f.min) def.min = Number(f.min)
        if (f.max) def.max = Number(f.max)
        if (f.kind === 'enum' && f.options) {
          def.options = f.options.split(',').map((s) => s.trim()).filter(Boolean)
        }
        return def
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (fieldsParsed.length === 0) {
      setError('Todos campos precisam de key + label')
      return
    }

    startTransition(async () => {
      const result = await createAssessmentType({
        name,
        description: String(fd.get('description') ?? '').trim() || undefined,
        category,
        vertical: vertical || undefined,
        fields: fieldsParsed as Parameters<typeof createAssessmentType>[0]['fields'],
        clinicalReference: String(fd.get('clinicalReference') ?? '').trim() || undefined,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push('/app/avaliacoes/tipos')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-md border p-3 text-sm"
          style={{
            borderColor: 'var(--ev-danger, #ef4444)',
            color: 'var(--ev-danger, #ef4444)',
          }}
        >
          {error}
        </div>
      )}

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Identificação
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="block font-medium">Nome *</span>
            <input
              name="name"
              type="text"
              required
              placeholder="Antropometria Academia"
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="block font-medium">Descrição</span>
            <textarea
              name="description"
              rows={2}
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium">Categoria *</span>
            <select
              name="category"
              defaultValue="composicao_corporal"
              required
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            >
              <option value="composicao_corporal">Composição corporal</option>
              <option value="escala_funcional">Escala funcional</option>
              <option value="anamnese">Anamnese</option>
              <option value="teste_funcional">Teste funcional</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium">Vertical</span>
            <select
              name="vertical"
              defaultValue=""
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            >
              <option value="">(genérico)</option>
              <option value="academia">Academia</option>
              <option value="fisio">Fisioterapia</option>
              <option value="nutri">Nutrição</option>
            </select>
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="block font-medium">Referência clínica</span>
            <input
              name="clinicalReference"
              type="text"
              placeholder="Pollock & Jackson 1980"
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            Campos ({fields.length})
          </h2>
          <button
            type="button"
            onClick={() => setFields((prev) => [...prev, newField()])}
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-1.5 text-xs hover:bg-[color:var(--ev-surface)]"
          >
            + Adicionar campo
          </button>
        </header>

        {fields.map((f, idx) => (
          <div
            key={idx}
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3 space-y-2"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Campo {idx + 1}</span>
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeField(idx)}
                  style={{ color: 'var(--ev-danger, #ef4444)' }}
                  className="hover:underline"
                >
                  remover
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5 text-xs">
                <span className="block font-medium">Key</span>
                <input
                  type="text"
                  value={f.key}
                  onChange={(e) => updateField(idx, { key: e.target.value })}
                  placeholder="peso_kg"
                  className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                />
              </label>
              <label className="space-y-0.5 text-xs">
                <span className="block font-medium">Label</span>
                <input
                  type="text"
                  value={f.label}
                  onChange={(e) => updateField(idx, { label: e.target.value })}
                  placeholder="Peso (kg)"
                  className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                />
              </label>
              <label className="space-y-0.5 text-xs">
                <span className="block font-medium">Kind</span>
                <select
                  value={f.kind}
                  onChange={(e) =>
                    updateField(idx, {
                      kind: e.target.value as FieldDraft['kind'],
                    })
                  }
                  className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                >
                  <option value="number">Number</option>
                  <option value="text">Text</option>
                  <option value="enum">Enum</option>
                  <option value="likert">Likert (0-N)</option>
                </select>
              </label>
              <label className="space-y-0.5 text-xs">
                <span className="block font-medium">Unidade</span>
                <input
                  type="text"
                  value={f.unit}
                  onChange={(e) => updateField(idx, { unit: e.target.value })}
                  placeholder="kg / cm / %"
                  className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                />
              </label>
              {(f.kind === 'number' || f.kind === 'likert') && (
                <>
                  <label className="space-y-0.5 text-xs">
                    <span className="block font-medium">Min</span>
                    <input
                      type="number"
                      step="any"
                      value={f.min}
                      onChange={(e) => updateField(idx, { min: e.target.value })}
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                    />
                  </label>
                  <label className="space-y-0.5 text-xs">
                    <span className="block font-medium">Max</span>
                    <input
                      type="number"
                      step="any"
                      value={f.max}
                      onChange={(e) => updateField(idx, { max: e.target.value })}
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                    />
                  </label>
                </>
              )}
              {f.kind === 'enum' && (
                <label className="space-y-0.5 text-xs col-span-2">
                  <span className="block font-medium">Opções (vírgula)</span>
                  <input
                    type="text"
                    value={f.options}
                    onChange={(e) => updateField(idx, { options: e.target.value })}
                    placeholder="sedentario, leve, moderado, intenso"
                    className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                  />
                </label>
              )}
            </div>
          </div>
        ))}
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Criando...' : 'Criar tipo'}
        </button>
      </div>
    </form>
  )
}
