'use client'

import { confirm } from '@repo/ui/messages'
import { useRouter } from 'next/navigation'
/**
 * Cancel button — chama cancelMyAppointment + reload.
 *
 * Sprint 26 Faixa C (26b) → Sprint 02c cleanup: substituído `window.confirm()`
 * por `confirm()` helper de `@repo/ui/messages` (regra 45 + ADR 0089). Dialog
 * renderiza via `<MessageHost>` no layout. Sprint 26b+ pode adicionar swipe
 * gestures pra UX mobile mais fluida.
 */
import { useState, useTransition } from 'react'
import { cancelMyAppointment } from '../actions'

interface Props {
  appointmentId: string
}

export function CancelButton({ appointmentId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  async function handleClick() {
    const ok = await confirm({
      title: 'Cancelar agendamento?',
      body: 'Você tem certeza que quer cancelar este agendamento? Dependendo da política da empresa, o cancelamento pode ficar pendente de aprovação.',
      danger: true,
      confirmLabel: 'Sim, cancelar',
      cancelLabel: 'Manter',
    })
    if (!ok) return
    startTransition(async () => {
      setErr(null)
      try {
        const r = (await cancelMyAppointment({ appointmentId })) as
          | { ok: true; action: 'cancel_directly' | 'awaiting_provider_ack' }
          | { ok: false; error?: { message?: string } }
        if ('ok' in r && !r.ok) {
          setErr(r.error?.message ?? 'Não foi possível cancelar')
          return
        }
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="ev-portal-button ev-portal-button--ghost"
      >
        {pending ? 'Cancelando...' : 'Cancelar'}
      </button>
      {err ? (
        <p className="ev-portal-muted" style={{ color: 'var(--ev-danger)' }}>
          {err}
        </p>
      ) : null}
    </div>
  )
}
