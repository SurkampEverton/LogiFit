'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { cancelAppointment, checkInAppointment } from '../actions'

export function AppointmentActions({
  appointmentId,
  status,
}: {
  appointmentId: string
  status: 'booked' | 'checked_in'
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [showCancelForm, setShowCancelForm] = useState(false)

  async function handleCheckIn() {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await checkInAppointment({ appointmentId })
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    router.refresh()
  }

  async function handleCancel() {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await cancelAppointment({
      appointmentId,
      reason: cancelReason.trim() || undefined,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setShowCancelForm(false)
    setCancelReason('')
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-4">
      <h2 className="font-semibold">Ações</h2>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--ev-danger)] p-3 text-sm text-[color:var(--ev-danger)]"
        >
          {error}
        </div>
      )}

      {status === 'booked' && (
        <button
          type="button"
          onClick={handleCheckIn}
          disabled={busy}
          className="w-full rounded-md bg-[color:var(--ev-success, #10b981)] px-4 py-3 font-medium text-white disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          {busy ? 'Processando…' : '✓ Fazer check-in'}
        </button>
      )}

      {!showCancelForm ? (
        <button
          type="button"
          onClick={() => setShowCancelForm(true)}
          disabled={busy}
          className="w-full rounded-md border border-[color:var(--ev-danger)] px-4 py-3 font-medium text-[color:var(--ev-danger)] disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Cancelar agendamento
        </button>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="cancelReason" className="block text-sm font-medium">
              Motivo (opcional)
            </label>
            <input
              id="cancelReason"
              type="text"
              maxLength={500}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Ex: Member cancelou por motivo de saúde"
              className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
              style={{ minHeight: 'var(--ev-input-min, 48px)' }}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              className="flex-1 rounded-md bg-[color:var(--ev-danger)] px-4 py-3 font-medium text-white disabled:opacity-50"
              style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
            >
              {busy ? 'Cancelando…' : 'Confirmar cancelamento'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCancelForm(false)
                setCancelReason('')
              }}
              disabled={busy}
              className="rounded-md border border-[color:var(--ev-border)] px-4 py-3 font-medium"
              style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
            >
              Voltar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
