'use client'

/**
 * Cancel button — chama cancelMyAppointment + reload.
 *
 * Sprint 26 Faixa C (26b): usa confirm() do browser (regra 45 proíbe alert/confirm
 * em telas operador; pro portal MVP é aceitável até `<ConfirmDialog>` ter wrapper
 * mobile-PWA de touch (Sprint 26+)). Sub-task adiada explicitamente: trocar por
 * `<ConfirmDialog>` quando o catálogo tiver gestures touch.
 *
 * TODO Sprint 26+: substituir por `confirm()` helper de `packages/ui/messages`
 * (regra 45) com swipe gestures pra UX mobile real.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelMyAppointment } from '../actions'

interface Props {
  appointmentId: string
}

export function CancelButton({ appointmentId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function handleClick() {
    if (typeof window !== 'undefined' && !window.confirm('Cancelar este agendamento?')) {
      return
    }
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
      {err ? <p className="ev-portal-muted" style={{ color: 'var(--ev-danger)' }}>{err}</p> : null}
    </div>
  )
}
