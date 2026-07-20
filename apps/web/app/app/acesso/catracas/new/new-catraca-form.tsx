'use client'

import { useState } from 'react'
import { registerDevice } from '../../actions'

interface CompanyOption {
  id: string
  name: string
  type: string
}
interface UnitOption {
  id: string
  name: string
  companyId: string
}

const HARDWARE_OPTIONS = [
  { value: 'android-box', label: '📱 Android box (recomendado MVP)' },
  { value: 'ipad-relay', label: '📱 iPad + relé catraca tradicional' },
  { value: 'esp32-camera', label: '🔌 ESP32 + câmera OV2640' },
  { value: 'ip-camera', label: '🎥 Câmera IP + servidor edge' },
]

export function NewCatracaForm({
  availableCompanies,
  availableUnits,
}: {
  availableCompanies: CompanyOption[]
  availableUnits: UnitOption[]
}) {
  const [companyId, setCompanyId] = useState(availableCompanies[0]?.id ?? '')
  const [unitId, setUnitId] = useState('')
  const [label, setLabel] = useState('')
  const [hardwareType, setHardwareType] = useState('android-box')
  const [authModes, setAuthModes] = useState<string[]>(['qr'])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdToken, setCreatedToken] = useState<string | null>(null)

  const unitsForCompany = availableUnits.filter((u) => u.companyId === companyId)

  function toggleMode(mode: string) {
    setAuthModes((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const result = await registerDevice({
      companyId,
      unitId: unitId || undefined,
      label: label.trim(),
      authModes: authModes as Array<'qr' | 'facial' | 'manual'>,
      hardwareType,
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setCreatedToken(result.data.deviceToken)
  }

  if (createdToken) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[color:var(--ev-success, #10b981)] bg-[color:var(--ev-success-bg, #d1fae5)] p-4">
          <p className="font-semibold text-sm">✓ Catraca cadastrada</p>
          <p className="text-xs text-[color:var(--ev-text-muted)] mt-1">
            Copie o token abaixo e cole na configuração da catraca.{' '}
            <strong>Não será mostrado novamente</strong>.
          </p>
        </div>
        <div className="rounded-md border border-[color:var(--ev-border)] p-4">
          <label
            htmlFor="token-output"
            className="block text-xs font-medium text-[color:var(--ev-text-muted)] mb-2"
          >
            Token do dispositivo (header `x-device-token`)
          </label>
          <input
            id="token-output"
            type="text"
            readOnly
            value={createdToken}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface-muted)] px-3 py-2 font-mono text-xs"
          />
          <p className="text-xs text-[color:var(--ev-text-muted)] mt-2">
            Configure NTP na catraca antes do primeiro check-in (clock drift &gt;120s causa falso
            negativo — ADR 0017).
          </p>
        </div>
        <a
          href="/app/acesso/catracas"
          className="block rounded-md bg-[color:var(--ev-primary)] px-4 py-3 text-center font-medium text-[color:var(--ev-primary-foreground)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Concluído
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="companyId" className="block text-sm font-medium">
          Empresa <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <select
          id="companyId"
          required
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value)
            setUnitId('')
          }}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          {availableCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="unitId" className="block text-sm font-medium">
          Unit (opcional)
        </label>
        <select
          id="unitId"
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          <option value="">— Sem unit específica —</option>
          {unitsForCompany.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="label" className="block text-sm font-medium">
          Apelido <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <input
          id="label"
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ex: Catraca entrada principal"
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="hardwareType" className="block text-sm font-medium">
          Hardware
        </label>
        <select
          id="hardwareType"
          value={hardwareType}
          onChange={(e) => setHardwareType(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          {HARDWARE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="block text-sm font-medium">Modalidades de autenticação</legend>
        <div className="flex flex-wrap gap-3">
          {[
            { value: 'qr', label: 'QR HMAC (default)' },
            { value: 'facial', label: 'Reconhecimento facial (Sprint 09+)', disabled: true },
            { value: 'manual', label: 'Manual recepção' },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={authModes.includes(opt.value)}
                onChange={() => toggleMode(opt.value)}
                disabled={opt.disabled}
              />
              <span className={opt.disabled ? 'text-[color:var(--ev-text-muted)]' : undefined}>
                {opt.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

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
          disabled={submitting || !companyId || !label.trim() || authModes.length === 0}
          className="flex-1 rounded-md bg-[color:var(--ev-primary)] px-4 py-3 font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          {submitting ? 'Cadastrando…' : 'Cadastrar catraca'}
        </button>
        <a
          href="/app/acesso/catracas"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-3 font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Cancelar
        </a>
      </div>
    </form>
  )
}
