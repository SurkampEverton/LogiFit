'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  attestRegistration,
  createRegistration,
  updateRegistrationSituation,
} from './actions'

type CouncilBody = 'CRM' | 'CRN' | 'CREFITO' | 'CREF' | 'CRF' | 'CRP' | 'COREN' | 'CRO'
type Situation =
  | 'active'
  | 'suspended'
  | 'cassated'
  | 'expired'
  | 'pending_verification'
  | 'unknown'

interface Registration {
  id: string
  councilBody: CouncilBody
  councilNumber: string
  councilState: string
  specialty: string | null
  situation: Situation
  verifiedAt: Date | string | null
  validUntil: string | null
}

const SITUATION_LABELS: Record<Situation, string> = {
  active: 'Ativo',
  suspended: 'Suspenso',
  cassated: 'Cassado',
  expired: 'Vencido',
  pending_verification: 'Aguardando atestação',
  unknown: 'Desconhecido',
}

const SITUATION_BADGE: Record<Situation, string> = {
  active: 'bg-[color:var(--ev-success-bg)]',
  pending_verification: 'bg-[color:var(--ev-warning-bg)]',
  suspended: 'bg-[color:var(--ev-warning-bg)]',
  cassated: 'bg-[color:var(--ev-danger-bg)] text-[color:var(--ev-danger)]',
  expired: 'bg-[color:var(--ev-warning-bg)]',
  unknown: 'bg-[color:var(--ev-surface)]',
}

export function RegistrosClient({
  personId,
  initialRegistrations,
}: {
  personId: string
  initialRegistrations: Registration[]
}) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(initialRegistrations.length === 0)

  return (
    <div className="space-y-4">
      {initialRegistrations.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--ev-border)] p-6 text-center text-sm text-[color:var(--ev-text-muted)]">
          Nenhum registro cadastrado.
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--ev-border)] rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)]">
          {initialRegistrations.map((r) => (
            <RegistrationItem key={r.id} reg={r} onChange={() => router.refresh()} />
          ))}
        </ul>
      )}

      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 text-sm font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          + Adicionar registro
        </button>
      )}

      {showForm && (
        <NewRegistrationForm
          personId={personId}
          onCancel={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function RegistrationItem({
  reg,
  onChange,
}: {
  reg: Registration
  onChange: () => void
}) {
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAttest() {
    setUpdating(true)
    setError(null)
    const result = await attestRegistration({ registrationId: reg.id })
    setUpdating(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onChange()
  }

  async function handleSetSituation(newSituation: Situation) {
    setUpdating(true)
    setError(null)
    const result = await updateRegistrationSituation({
      registrationId: reg.id,
      newSituation,
    })
    setUpdating(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onChange()
  }

  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">
          {reg.councilBody}-{reg.councilState}/{reg.councilNumber}
        </span>
        <span
          className={`text-xs uppercase rounded-full px-2 py-0.5 ${SITUATION_BADGE[reg.situation]}`}
        >
          {SITUATION_LABELS[reg.situation]}
        </span>
        {reg.specialty && (
          <span className="text-xs text-[color:var(--ev-text-muted)]">{reg.specialty}</span>
        )}
      </div>

      {reg.validUntil && (
        <p className="text-xs text-[color:var(--ev-text-muted)]">
          Anuidade vence em: {reg.validUntil}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-[color:var(--ev-danger)]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        {reg.situation === 'pending_verification' && (
          <button
            type="button"
            onClick={handleAttest}
            disabled={updating}
            className="rounded-md bg-[color:var(--ev-primary)] px-3 py-1.5 font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
          >
            {updating ? 'Atestando…' : 'Atestar como ativo'}
          </button>
        )}
        {reg.situation === 'active' && (
          <button
            type="button"
            onClick={() => handleSetSituation('suspended')}
            disabled={updating}
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-1.5 hover:bg-[color:var(--ev-surface)] disabled:opacity-50"
          >
            Marcar suspenso
          </button>
        )}
        {(reg.situation === 'suspended' || reg.situation === 'expired') && (
          <button
            type="button"
            onClick={() => handleSetSituation('active')}
            disabled={updating}
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-1.5 hover:bg-[color:var(--ev-surface)] disabled:opacity-50"
          >
            Reativar
          </button>
        )}
      </div>
    </li>
  )
}

function NewRegistrationForm({
  personId,
  onCancel,
  onSuccess,
}: {
  personId: string
  onCancel: () => void
  onSuccess: () => void
}) {
  const [councilBody, setCouncilBody] = useState<CouncilBody>('CREFITO')
  const [councilNumber, setCouncilNumber] = useState('')
  const [councilState, setCouncilState] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await createRegistration({
      personId,
      councilBody,
      councilNumber,
      councilState,
      specialty: specialty || undefined,
      validUntil: validUntil || undefined,
    })

    setSubmitting(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onSuccess()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-4 space-y-3"
    >
      <h3 className="font-semibold">Novo registro</h3>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="cb" className="block text-sm font-medium">
            Conselho <span className="text-[color:var(--ev-danger)]">*</span>
          </label>
          <select
            id="cb"
            value={councilBody}
            onChange={(e) => setCouncilBody(e.target.value as CouncilBody)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          >
            <option value="CRM">CRM (Médico)</option>
            <option value="CRN">CRN (Nutricionista)</option>
            <option value="CREFITO">CREFITO (Fisioterapeuta)</option>
            <option value="CREF">CREF (Personal/Educador Físico)</option>
            <option value="CRF">CRF (Farmacêutico)</option>
            <option value="CRP">CRP (Psicólogo)</option>
            <option value="COREN">COREN (Enfermeiro)</option>
            <option value="CRO">CRO (Dentista)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="num" className="block text-sm font-medium">
            Número <span className="text-[color:var(--ev-danger)]">*</span>
          </label>
          <input
            id="num"
            type="text"
            required
            value={councilNumber}
            onChange={(e) => setCouncilNumber(e.target.value)}
            placeholder="12345"
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="uf" className="block text-sm font-medium">
            UF <span className="text-[color:var(--ev-danger)]">*</span>
          </label>
          <input
            id="uf"
            type="text"
            required
            maxLength={2}
            value={councilState}
            onChange={(e) => setCouncilState(e.target.value.toUpperCase())}
            placeholder="SP"
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="spec" className="block text-sm font-medium">
            Especialidade
          </label>
          <input
            id="spec"
            type="text"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            placeholder="Ortopedia, Pediatria, …"
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="valid" className="block text-sm font-medium">
            Anuidade vence em
          </label>
          <input
            id="valid"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--ev-danger)] p-3 text-sm text-[color:var(--ev-danger)]"
        >
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !councilNumber || !councilState}
          className="flex-1 rounded-md bg-[color:var(--ev-primary)] px-4 py-2 font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          {submitting ? 'Salvando…' : 'Cadastrar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
