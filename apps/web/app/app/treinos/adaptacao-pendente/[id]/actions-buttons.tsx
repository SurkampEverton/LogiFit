'use client'

import { confirm, prompt } from '@repo/ui/messages'
import { useRouter } from 'next/navigation'
/**
 * Botões de ação para confirmar/rejeitar adaptação — Sprint 27 Faixa C
 * (regra 45 + ADR 0089 — substituído window.confirm/prompt por confirm()/prompt()
 * do catálogo `@repo/ui/messages` no fechamento Sprint 02c cleanup).
 */
import { useState, useTransition } from 'react'
import { confirmAdaptation, rejectAdaptation } from '../../../cross/actions'

interface Props {
  adaptationId: string
}

export function AdaptationActions({ adaptationId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  async function handleConfirm() {
    const ok = await confirm({
      title: 'Confirmar adaptação',
      body: 'A nova ficha será gerada (versionada) e atribuída ao paciente. Esta ação é registrada em audit.',
      confirmLabel: 'Confirmar e aplicar',
    })
    if (!ok) return
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

  async function handleReject() {
    const reason = await prompt({
      title: 'Rejeitar adaptação',
      label: 'Motivo da rejeição',
      placeholder: 'Ex: instrutor já tinha ajustado a ficha manualmente',
      validator: (v) =>
        v.trim().length < 2 ? 'Informe um motivo com pelo menos 2 caracteres' : null,
      confirmLabel: 'Rejeitar',
    })
    if (!reason) return
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
