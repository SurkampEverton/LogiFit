'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { createAssessment } from '../../../../avaliacoes/actions'

interface FieldDef {
  key: string
  label: string
  kind: 'number' | 'text' | 'enum' | 'likert'
  unit?: string
  min?: number
  max?: number
  options?: string[]
}

interface AssessmentTypeOption {
  id: string
  name: string
  category: string
  vertical: string | null
  isGlobal: boolean
  fields: FieldDef[]
}

interface Props {
  memberId: string
  types: AssessmentTypeOption[]
  defaultAgeYears: number | null
  defaultSex: 'male' | 'female' | null
}

export function NewAssessmentForm({ memberId, types, defaultAgeYears, defaultSex }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selectedTypeId, setSelectedTypeId] = useState<string>('')
  const [values, setValues] = useState<Record<string, string>>({})

  const selectedType = useMemo(
    () => types.find((t) => t.id === selectedTypeId) ?? null,
    [selectedTypeId, types],
  )

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!selectedType) {
      setError('Escolha um tipo de avaliação')
      return
    }
    const fd = new FormData(e.currentTarget)
    const performedAt = String(fd.get('performedAt'))
    const notes = String(fd.get('notes') ?? '').trim()
    const ageRaw = String(fd.get('ageYears') ?? '').trim()
    const sexRaw = String(fd.get('sex') ?? '') as 'male' | 'female' | ''
    const heightRaw = String(fd.get('heightCm') ?? '').trim()

    const measurements: {
      fieldKey: string
      valueNum?: number
      valueText?: string
      valueEnum?: string
    }[] = []

    for (const f of selectedType.fields) {
      const raw = values[f.key]
      if (raw === undefined || raw === '') continue
      if (f.kind === 'number' || f.kind === 'likert') {
        const n = Number(raw)
        if (!Number.isFinite(n)) {
          setError(`Campo ${f.label}: valor numérico inválido`)
          return
        }
        measurements.push({ fieldKey: f.key, valueNum: n })
      } else if (f.kind === 'enum') {
        measurements.push({ fieldKey: f.key, valueEnum: raw })
      } else {
        measurements.push({ fieldKey: f.key, valueText: raw })
      }
    }

    if (measurements.length === 0) {
      setError('Preencha ao menos 1 campo')
      return
    }

    startTransition(async () => {
      const result = await createAssessment({
        memberId,
        assessmentTypeId: selectedType.id,
        performedAt: new Date(performedAt).toISOString(),
        notes: notes || undefined,
        measurements,
        context: {
          ageYears: ageRaw ? Number(ageRaw) : undefined,
          sex: sexRaw || undefined,
          heightCm: heightRaw ? Number(heightRaw) : undefined,
        },
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push(`/app/members/${memberId}/avaliacoes/${result.data.id}`)
      router.refresh()
    })
  }

  const todayIso = new Date().toISOString().slice(0, 16) // datetime-local format

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
          Tipo e data
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="block font-medium">Tipo *</span>
            <select
              value={selectedTypeId}
              onChange={(e) => {
                setSelectedTypeId(e.target.value)
                setValues({})
              }}
              required
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            >
              <option value="">(escolha)</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.isGlobal ? '· Global' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium">Data *</span>
            <input
              name="performedAt"
              type="datetime-local"
              defaultValue={todayIso}
              required
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            />
          </label>
        </div>
      </section>

      {selectedType && (
        <>
          <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
              Contexto p/ cálculos
            </h2>
            <p className="text-xs text-[color:var(--ev-text-muted)]">
              Idade + sexo + altura permitem calcular IMC, % gordura Pollock, TMB automaticamente.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="block font-medium">Idade</span>
                <input
                  name="ageYears"
                  type="number"
                  min="1"
                  max="120"
                  defaultValue={defaultAgeYears ?? ''}
                  className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block font-medium">Sexo</span>
                <select
                  name="sex"
                  defaultValue={defaultSex ?? ''}
                  className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
                >
                  <option value="">—</option>
                  <option value="male">Masculino</option>
                  <option value="female">Feminino</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block font-medium">Altura (cm)</span>
                <input
                  name="heightCm"
                  type="number"
                  min="50"
                  max="250"
                  step="0.5"
                  className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
              Medidas ({selectedType.fields.length} campos)
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedType.fields.map((f) => (
                <label key={f.key} className="space-y-1 text-sm">
                  <span className="block font-medium">
                    {f.label}
                    {f.unit && (
                      <span className="text-[color:var(--ev-text-muted)] font-normal">
                        {' '}
                        ({f.unit})
                      </span>
                    )}
                  </span>
                  {f.kind === 'enum' ? (
                    <select
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
                    >
                      <option value="">—</option>
                      {(f.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : f.kind === 'text' ? (
                    <textarea
                      rows={2}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
                    />
                  ) : (
                    <input
                      type="number"
                      step="any"
                      min={f.min}
                      max={f.max}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
                    />
                  )}
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
              Notas
            </h2>
            <textarea
              name="notes"
              rows={3}
              placeholder="Observações da sessão, condições de medição..."
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            />
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? 'Salvando...' : 'Salvar avaliação'}
            </button>
          </div>
        </>
      )}
    </form>
  )
}
