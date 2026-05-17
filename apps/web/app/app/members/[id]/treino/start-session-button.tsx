'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { startSession } from '../../../treinos/actions'

interface Props {
  prescriptionId: string
  memberId: string
}

export function StartSessionButton({ prescriptionId, memberId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      const result = await startSession({ prescriptionId })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push(`/app/members/${memberId}/treino/sessao/${result.data.id}`)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-[color:var(--ev-primary)] px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Iniciando...' : '▶ Iniciar sessão'}
      </button>
      {error && (
        <span className="text-xs" style={{ color: 'var(--ev-danger, #ef4444)' }}>
          {error}
        </span>
      )}
    </>
  )
}
