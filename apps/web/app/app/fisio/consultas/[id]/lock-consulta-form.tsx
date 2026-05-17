'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { lockConsulta } from '../actions'

type Attempt = 'icp_brasil_a1' | 'icp_brasil_a3' | 'authenticated_mfa'

const ATTEMPT_LABEL: Record<Attempt, string> = {
  icp_brasil_a3: '🔑 ICP-Brasil A3 (token/cartão)',
  icp_brasil_a1: '🔐 ICP-Brasil A1 (HSM)',
  authenticated_mfa: '🔒 Lacre autenticado (MFA recente)',
}

export function LockConsultaForm({
  consultaId,
  signatureMode,
  hasPrincipalCid,
}: {
  consultaId: string
  signatureMode: string
  hasPrincipalCid: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [attempt, setAttempt] = useState<Attempt>(
    signatureMode === 'icp_required' ? 'icp_brasil_a3' : 'authenticated_mfa',
  )
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    if (!hasPrincipalCid) {
      setError('Pelo menos 1 CID principal antes de fechar')
      return
    }
    startTransition(async () => {
      const r = await lockConsulta({
        consultaId,
        attempt,
        signatureProvider:
          attempt !== 'authenticated_mfa' ? 'placeholder-icp-provider' : null,
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Método</span>
        <select
          className="ev-input"
          value={attempt}
          onChange={(e) => setAttempt(e.target.value as Attempt)}
        >
          {(Object.keys(ATTEMPT_LABEL) as Attempt[]).map((k) => (
            <option key={k} value={k}>
              {ATTEMPT_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <button onClick={submit} className="ev-btn ev-btn-primary" disabled={pending}>
        {pending ? 'Fechando...' : '🔒 Fechar consulta'}
      </button>
      {error && (
        <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-danger)' }}>{error}</span>
      )}
    </div>
  )
}
