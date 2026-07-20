'use client'

import { useRouter } from 'next/navigation'
/**
 * Form de novo registro de diário — Sprint 31 Faixa C.
 *
 * MVP: meal_name + consumed_date (hoje default) + free_text_description.
 * Sprint 31b: picker de foods + foto + horário + measure caseira.
 */
import { useState, useTransition } from 'react'
import { logMeal } from '../actions'

type MealName =
  | 'cafe'
  | 'lanche_manha'
  | 'almoco'
  | 'lanche_tarde'
  | 'jantar'
  | 'ceia'
  | 'pre_treino'
  | 'pos_treino'
  | 'outro'

const MEAL_OPTIONS: Array<{ value: MealName; label: string }> = [
  { value: 'cafe', label: 'Café da manhã' },
  { value: 'lanche_manha', label: 'Lanche da manhã' },
  { value: 'almoco', label: 'Almoço' },
  { value: 'lanche_tarde', label: 'Lanche da tarde' },
  { value: 'jantar', label: 'Jantar' },
  { value: 'ceia', label: 'Ceia' },
  { value: 'pre_treino', label: 'Pré-treino' },
  { value: 'pos_treino', label: 'Pós-treino' },
  { value: 'outro', label: 'Outro' },
]

const MEAL_VALUES = MEAL_OPTIONS.map((o) => o.value)
function isMealName(v: string): v is MealName {
  return (MEAL_VALUES as string[]).includes(v)
}

interface Props {
  initialMeal: string | null
}

export function NewDiaryForm({ initialMeal }: Props) {
  const router = useRouter()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [mealName, setMealName] = useState<MealName>(
    initialMeal && isMealName(initialMeal) ? initialMeal : 'almoco',
  )
  const [freeText, setFreeText] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!freeText.trim() && !notes.trim()) {
      setErr('Descreva pelo menos o que comeu (texto ou observação).')
      return
    }
    startTransition(async () => {
      try {
        const r = (await logMeal({
          consumedDate: date,
          mealName,
          freeTextDescription: freeText || null,
          notes: notes || null,
          items: [],
        })) as { ok: true; id: string } | { ok: false; error?: { message?: string } }
        if ('ok' in r && !r.ok) {
          setErr(r.error?.message ?? 'Falha')
          return
        }
        router.push('/meu/diario')
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="ev-portal-form">
      <label className="ev-portal-label" htmlFor="date">
        Data
      </label>
      <input
        type="date"
        id="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        max={today}
        className="ev-portal-input"
        required
      />

      <label className="ev-portal-label" htmlFor="meal">
        Refeição
      </label>
      <select
        id="meal"
        value={mealName}
        onChange={(e) => {
          if (isMealName(e.target.value)) setMealName(e.target.value)
        }}
        className="ev-portal-select"
      >
        {MEAL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <label className="ev-portal-label" htmlFor="freeText">
        O que comeu?
      </label>
      <textarea
        id="freeText"
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
        placeholder="Ex: 1 prato de arroz, feijão, frango grelhado e salada de alface."
        rows={4}
        className="ev-portal-textarea"
      />

      <label className="ev-portal-label" htmlFor="notes">
        Observação (opcional)
      </label>
      <textarea
        id="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Como se sentiu? Estava com fome? Algo a destacar?"
        rows={3}
        className="ev-portal-textarea"
      />

      <button type="submit" disabled={pending} className="ev-portal-button">
        {pending ? 'Registrando...' : 'Registrar refeição'}
      </button>

      {err ? (
        <div
          style={{
            padding: 'var(--ev-space-2)',
            backgroundColor: 'var(--ev-danger-soft)',
            color: 'var(--ev-danger-hover)',
            borderRadius: 'var(--ev-radius-sm)',
          }}
        >
          {err}
        </div>
      ) : null}

      <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-xs)' }}>
        Picker de alimentos do catálogo + upload de foto entram em próxima versão.
      </p>
    </form>
  )
}
