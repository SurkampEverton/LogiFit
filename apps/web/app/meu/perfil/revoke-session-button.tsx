'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { revokeMySession } from '../actions'

interface Props {
  sessionId: string
}

export function RevokeSessionButton({ sessionId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (typeof window !== 'undefined' && !window.confirm('Encerrar sessão neste dispositivo?')) {
      return
    }
    startTransition(async () => {
      await revokeMySession({ sessionId })
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="ev-portal-button ev-portal-button--ghost"
    >
      {pending ? 'Encerrando...' : 'Encerrar'}
    </button>
  )
}
