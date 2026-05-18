'use client'

/**
 * Consent toggle — chama updateMyConsent e re-renderiza.
 *
 * Mobile-friendly: botão único com label dinâmico (não switch, pois switch
 * em iOS é tap-target pequeno demais — botão respeita 44px touch).
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateMyConsent } from '../actions'
import type { ConsentPurpose } from '@repo/db/portal-member'

interface Props {
  purpose: ConsentPurpose
  initialGranted: boolean
}

export function ConsentToggle({ purpose, initialGranted }: Props) {
  const router = useRouter()
  const [granted, setGranted] = useState(initialGranted)
  const [pending, startTransition] = useTransition()

  function handleClick() {
    const next = !granted
    startTransition(async () => {
      await updateMyConsent({ purpose, granted: next })
      setGranted(next)
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={`ev-portal-button ${granted ? '' : 'ev-portal-button--ghost'}`}
      aria-pressed={granted}
    >
      {pending ? '...' : granted ? 'Ativo' : 'Inativo'}
    </button>
  )
}
