'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { logoutMember } from '../actions'

export function LogoutButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      await logoutMember()
      router.push('/meu/login')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="ev-portal-button ev-portal-button--danger"
    >
      {pending ? 'Saindo...' : 'Sair'}
    </button>
  )
}
