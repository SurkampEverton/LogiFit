'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirm } from '@repo/ui/messages'
import { revokeMySession } from '../actions'

interface Props {
  sessionId: string
}

export function RevokeSessionButton({ sessionId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  async function handleClick() {
    const ok = await confirm({
      title: 'Encerrar sessão?',
      body: 'Esta sessão será deslogada imediatamente. Você precisará entrar de novo no dispositivo correspondente.',
      danger: true,
      confirmLabel: 'Encerrar',
    })
    if (!ok) return
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
