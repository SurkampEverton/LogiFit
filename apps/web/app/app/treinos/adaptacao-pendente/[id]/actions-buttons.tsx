'use client'

/**
 * Botões de ação para confirmar/rejeitar adaptação — Sprint 27 Faixa C.
 *
 * Usa window.confirm/prompt no MVP (regra 45 prevê substituir por
 * `<ConfirmDialog>`/`<PromptDialog>` em Sprint 27b quando catálogo de mensagens
 * estiver materializado em packages/ui/components/messages).
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmAdaptation, rejectAdaptation } from '../../../cross/actions'

interface Props {
  adaptationId: string
}

export function AdaptationActions({ adaptationId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function handleConfirm() {
    if (typeof window !== 'undefined' && !window.confirm('Confirmar adaptação e atribuir nova ficha?')) {
      return
    }
    startTransition(async () => {
      setErr(null)
      try {
        const r = (await confirmAdaptation({ adaptationId })) as
          | { ok: true; adaptedWorkoutId: string }
          | { ok: false; error?: { message?: string } }
        if ('ok' in r && !r.ok) {
          setErr(r.error?.message ?? 'Falha ao confirmar')
          return
        }
        router.refresh()
        router.push('/app/treinos/adaptacao-pendente')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  function handleReject() {
    if (typeof window === 'undefined') return
    const reason = window.prompt('Motivo da rejeição (mín 2 caracteres):')
    if (!reason || reason.trim().length < 2) return
    startTransition(async () => {
      setErr(null)
      try {
        const r = (await rejectAdaptation({ adaptationId, reason: reason.trim() })) as
          | { ok: true }
          | { ok: false; error?: { message?: string } }
        if ('ok' in r && !r.ok) {
          setErr(r.error?.message ?? 'Falha ao rejeitar')
          return
        }
        router.refresh()
        router.push('/app/treinos/adaptacao-pendente')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
      <button
        type="button"
        onClick={handleConfirm}
        disabled={pending}
        className="ev-btn ev-btn-primary"
      >
        {pending ? '...' : 'Confirmar e aplicar'}
      </button>
      <button
        type="button"
        onClick={handleReject}
        disabled={pending}
        className="ev-btn ev-btn-ghost"
      >
        Rejeitar
      </button>
      {err ? <span style={{ color: 'var(--ev-danger)' }}>{err}</span> : null}
    </div>
  )
}
