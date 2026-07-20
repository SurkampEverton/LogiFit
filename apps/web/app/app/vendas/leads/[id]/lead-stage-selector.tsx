'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { moveLeadToStage } from '../../actions'

interface Stage {
  id: string
  slug: string
  name: string
  orderIdx: number
  kind: 'open' | 'won' | 'lost'
}

interface Props {
  leadId: string
  currentStageId: string
  stages: Stage[]
}

export function LeadStageSelector({ leadId, currentStageId, stages }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(currentStageId)

  function onChange(stageId: string) {
    if (stageId === currentStageId) return
    setSelected(stageId)
    setError(null)
    startTransition(async () => {
      const result = await moveLeadToStage({ leadId, toStageId: stageId })
      if (!result.ok) {
        setError(result.error.message)
        setSelected(currentStageId)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {stages.map((s) => {
          const active = s.id === selected
          return (
            <button
              key={s.id}
              type="button"
              disabled={pending}
              onClick={() => onChange(s.id)}
              className="rounded-full px-3 py-1 text-xs font-medium border transition disabled:opacity-50"
              style={{
                borderColor: active ? 'var(--ev-primary)' : 'var(--ev-border)',
                backgroundColor: active ? 'var(--ev-primary)' : 'transparent',
                color: active ? 'white' : 'var(--ev-text)',
              }}
            >
              {s.name}
              {s.kind === 'won' && ' 🏆'}
              {s.kind === 'lost' && ' ✗'}
            </button>
          )
        })}
      </div>
      {error && (
        <div role="alert" className="text-xs" style={{ color: 'var(--ev-danger, #ef4444)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
