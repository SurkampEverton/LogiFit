'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { archiveLead, convertLeadToMember } from '../../actions'

interface ProposalOption {
  id: string
  version: number
  status: string
}

interface Props {
  leadId: string
  hasPersonId: boolean
  proposalsList: ProposalOption[]
}

export function LeadActions({ leadId, hasPersonId, proposalsList }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
  const [convertOpen, setConvertOpen] = useState(false)
  const [proposalId, setProposalId] = useState<string>('')

  function onArchive() {
    if (!archiveReason.trim()) {
      setError('Informe o motivo')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await archiveLead({ leadId, reason: archiveReason.trim() })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setArchiveOpen(false)
      router.refresh()
    })
  }

  function onConvert() {
    setError(null)
    startTransition(async () => {
      const result = await convertLeadToMember({
        leadId,
        proposalId: proposalId || undefined,
        billingDay: 10,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setConvertOpen(false)
      router.push(`/app/members/${result.data.memberId}`)
      router.refresh()
    })
  }

  return (
    <section className="rounded-xl border border-[color:var(--ev-border)] p-4 space-y-3">
      <h2 className="text-sm font-medium">Ações</h2>
      {error && (
        <div
          role="alert"
          className="rounded-md border p-2 text-xs"
          style={{
            borderColor: 'var(--ev-danger, #ef4444)',
            color: 'var(--ev-danger, #ef4444)',
          }}
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setConvertOpen((o) => !o)}
          disabled={pending || !hasPersonId}
          className="rounded-md bg-[color:var(--ev-primary)] px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
          title={!hasPersonId ? 'Lead exige person_id (CPF confirmado) pra conversão' : undefined}
        >
          Converter em member
        </button>
        <button
          type="button"
          onClick={() => setArchiveOpen((o) => !o)}
          disabled={pending}
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)] disabled:opacity-50"
        >
          Arquivar (perdido)
        </button>
      </div>

      {!hasPersonId && (
        <p className="text-xs text-[color:var(--ev-text-muted)]">
          ℹ️ Conversão exige <strong>person_id confirmada</strong>. Avance pra estágio
          "proposta" pra acionar o upgrade (Faixa D+).
        </p>
      )}

      {convertOpen && hasPersonId && (
        <div className="rounded-md border border-[color:var(--ev-border)] p-3 space-y-2 bg-[color:var(--ev-surface)]">
          <label className="block text-sm">
            <span className="block font-medium mb-1">Proposta aceita (opcional)</span>
            <select
              value={proposalId}
              onChange={(e) => setProposalId(e.target.value)}
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2 text-sm"
            >
              <option value="">(sem proposta — só criar member)</option>
              {proposalsList.map((p) => (
                <option key={p.id} value={p.id}>
                  v{p.version} ({p.status})
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setConvertOpen(false)}
              className="rounded-md border border-[color:var(--ev-border)] px-3 py-1 text-xs"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onConvert}
              className="rounded-md bg-[color:var(--ev-primary)] px-3 py-1 text-xs text-white disabled:opacity-50"
            >
              {pending ? 'Convertendo...' : 'Confirmar conversão'}
            </button>
          </div>
        </div>
      )}

      {archiveOpen && (
        <div className="rounded-md border border-[color:var(--ev-border)] p-3 space-y-2 bg-[color:var(--ev-surface)]">
          <label className="block text-sm">
            <span className="block font-medium mb-1">Motivo</span>
            <input
              type="text"
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="preço · localização · concorrência · desistência"
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setArchiveOpen(false)}
              className="rounded-md border border-[color:var(--ev-border)] px-3 py-1 text-xs"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onArchive}
              className="rounded-md px-3 py-1 text-xs text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--ev-danger, #ef4444)' }}
            >
              {pending ? 'Arquivando...' : 'Confirmar arquivamento'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
