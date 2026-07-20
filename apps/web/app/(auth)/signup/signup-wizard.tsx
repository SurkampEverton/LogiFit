'use client'

import { useState } from 'react'
import { onboardTenant } from './actions'

/**
 * Wizard `/signup` em 3 etapas:
 *   1. Empresa (CNPJ + auto-fill + razão social + slug subdomínio)
 *   2. Unidade inicial (nome + endereço)
 *   3. Admin (email + nome + CPF opcional)
 *
 * Submit final dispara `onboardTenant` Server Action (transação atômica).
 * Sucesso → tela final "Confira seu email" (magic link enviado).
 */

type Step = 'empresa' | 'unidade' | 'admin' | 'success'

interface FormState {
  cnpj: string
  empresaRazaoSocial: string
  empresaNomeFantasia: string
  empresaTenantSlug: string
  unitName: string
  unitAddress: {
    cep: string
    logradouro: string
    numero: string
    complemento: string
    bairro: string
    cidade: string
    uf: string
  }
  adminEmail: string
  adminName: string
  adminCpf: string
}

const initialState: FormState = {
  cnpj: '',
  empresaRazaoSocial: '',
  empresaNomeFantasia: '',
  empresaTenantSlug: '',
  unitName: '',
  unitAddress: {
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
  },
  adminEmail: '',
  adminName: '',
  adminCpf: '',
}

export function SignupWizard() {
  const [step, setStep] = useState<Step>('empresa')
  const [form, setForm] = useState<FormState>(initialState)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'fetching' | 'ok' | 'error'>('idle')

  async function handleCnpjBlur() {
    const digits = form.cnpj.replace(/\D/g, '')
    if (digits.length !== 14) return
    setLookupStatus('fetching')
    try {
      // safe-fetch-exempt: same-origin /api/pessoas/cnpj — endpoint LogiFit interno
      const res = await fetch(`/api/pessoas/cnpj/${digits}`, { cache: 'no-store' })
      const json = await res.json()
      if (!json.ok) {
        setLookupStatus('error')
        return
      }
      setForm((f) => ({
        ...f,
        empresaRazaoSocial: f.empresaRazaoSocial || json.data.razaoSocial,
        empresaNomeFantasia: f.empresaNomeFantasia || (json.data.nomeFantasia ?? ''),
        empresaTenantSlug:
          f.empresaTenantSlug ||
          (json.data.nomeFantasia || json.data.razaoSocial)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40),
        unitAddress: {
          ...f.unitAddress,
          cep: f.unitAddress.cep || (json.data.address?.cep ?? ''),
          logradouro: f.unitAddress.logradouro || (json.data.address?.logradouro ?? ''),
          numero: f.unitAddress.numero || (json.data.address?.numero ?? ''),
          complemento: f.unitAddress.complemento || (json.data.address?.complemento ?? ''),
          bairro: f.unitAddress.bairro || (json.data.address?.bairro ?? ''),
          cidade: f.unitAddress.cidade || (json.data.address?.cidade ?? ''),
          uf: f.unitAddress.uf || (json.data.address?.uf ?? ''),
        },
      }))
      setLookupStatus('ok')
    } catch {
      setLookupStatus('error')
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)

    const result = await onboardTenant({
      cnpj: form.cnpj,
      empresaRazaoSocial: form.empresaRazaoSocial,
      empresaNomeFantasia: form.empresaNomeFantasia || undefined,
      empresaTenantSlug: form.empresaTenantSlug,
      unitName: form.unitName,
      unitAddress: form.unitAddress,
      adminEmail: form.adminEmail,
      adminName: form.adminName,
      adminCpf: form.adminCpf || undefined,
    })

    setSubmitting(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setStep('success')
  }

  if (step === 'success') {
    return (
      <section
        role="status"
        className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 text-center space-y-3"
      >
        <h2 className="text-xl font-semibold">Tenant criado!</h2>
        <p className="text-base text-[color:var(--ev-text-muted)]">
          Enviamos um link mágico para <strong>{form.adminEmail}</strong>. Clique no link para fazer
          o primeiro login.
        </p>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Subdomínio do tenant: <code>{form.empresaTenantSlug}.logifit.com.br</code>
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6">
      {/* Stepper */}
      <ol className="mb-6 flex items-center justify-center gap-2 text-xs">
        {(['empresa', 'unidade', 'admin'] as const).map((s, idx) => (
          <li
            key={s}
            className={`flex items-center gap-2 ${step === s ? 'font-semibold' : 'text-[color:var(--ev-text-muted)]'}`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border ${step === s ? 'border-[color:var(--ev-primary)] bg-[color:var(--ev-primary)] text-[color:var(--ev-primary-foreground)]' : 'border-[color:var(--ev-border)]'}`}
            >
              {idx + 1}
            </span>
            {s === 'empresa' ? 'Empresa' : s === 'unidade' ? 'Unidade' : 'Admin'}
            {idx < 2 && <span className="text-[color:var(--ev-text-muted)]">→</span>}
          </li>
        ))}
      </ol>

      {step === 'empresa' && (
        <fieldset className="space-y-4">
          <legend className="sr-only">Dados da empresa</legend>

          <Field
            label="CNPJ"
            required
            id="cnpj"
            value={form.cnpj}
            onChange={(v) => setForm({ ...form, cnpj: v })}
            onBlur={handleCnpjBlur}
            placeholder="12.345.678/0001-90"
            inputMode="numeric"
            hint={
              lookupStatus === 'fetching'
                ? 'consultando Receita…'
                : lookupStatus === 'ok'
                  ? 'dados preenchidos automaticamente'
                  : lookupStatus === 'error'
                    ? 'CNPJ não encontrado — preencha manualmente'
                    : '14 dígitos. Buscamos dados na Receita Federal.'
            }
          />
          <Field
            label="Razão Social"
            required
            id="razao"
            value={form.empresaRazaoSocial}
            onChange={(v) => setForm({ ...form, empresaRazaoSocial: v })}
          />
          <Field
            label="Nome Fantasia (opcional)"
            id="fantasia"
            value={form.empresaNomeFantasia}
            onChange={(v) => setForm({ ...form, empresaNomeFantasia: v })}
          />
          <Field
            label="Subdomínio LogiFit"
            required
            id="slug"
            value={form.empresaTenantSlug}
            onChange={(v) =>
              setForm({
                ...form,
                empresaTenantSlug: v.toLowerCase().replace(/[^a-z0-9-]/g, ''),
              })
            }
            placeholder="academia-equilibrio"
            hint={`Sua URL será ${form.empresaTenantSlug || 'meu-tenant'}.logifit.com.br`}
          />

          <NavButtons
            onNext={() => setStep('unidade')}
            nextDisabled={!form.cnpj || !form.empresaRazaoSocial || !form.empresaTenantSlug}
          />
        </fieldset>
      )}

      {step === 'unidade' && (
        <fieldset className="space-y-4">
          <legend className="sr-only">Unidade inicial</legend>

          <Field
            label="Nome da unidade"
            required
            id="unitName"
            value={form.unitName}
            onChange={(v) => setForm({ ...form, unitName: v })}
            placeholder="Ex: Unidade Centro"
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="CEP"
              id="cep"
              value={form.unitAddress.cep}
              onChange={(v) => setForm({ ...form, unitAddress: { ...form.unitAddress, cep: v } })}
            />
            <Field
              label="Logradouro"
              id="logradouro"
              className="sm:col-span-2"
              value={form.unitAddress.logradouro}
              onChange={(v) =>
                setForm({ ...form, unitAddress: { ...form.unitAddress, logradouro: v } })
              }
            />
            <Field
              label="Número"
              id="numero"
              value={form.unitAddress.numero}
              onChange={(v) =>
                setForm({ ...form, unitAddress: { ...form.unitAddress, numero: v } })
              }
            />
            <Field
              label="Bairro"
              id="bairro"
              value={form.unitAddress.bairro}
              onChange={(v) =>
                setForm({ ...form, unitAddress: { ...form.unitAddress, bairro: v } })
              }
            />
            <Field
              label="Cidade"
              id="cidade"
              value={form.unitAddress.cidade}
              onChange={(v) =>
                setForm({ ...form, unitAddress: { ...form.unitAddress, cidade: v } })
              }
            />
            <Field
              label="UF"
              id="uf"
              maxLength={2}
              value={form.unitAddress.uf}
              onChange={(v) =>
                setForm({ ...form, unitAddress: { ...form.unitAddress, uf: v.toUpperCase() } })
              }
            />
          </div>

          <NavButtons
            onBack={() => setStep('empresa')}
            onNext={() => setStep('admin')}
            nextDisabled={!form.unitName}
          />
        </fieldset>
      )}

      {step === 'admin' && (
        <fieldset className="space-y-4">
          <legend className="sr-only">Administrador</legend>

          <Field
            label="Seu email"
            required
            id="adminEmail"
            type="email"
            value={form.adminEmail}
            onChange={(v) => setForm({ ...form, adminEmail: v })}
            hint="Enviamos um link mágico de acesso aqui."
          />
          <Field
            label="Seu nome completo"
            required
            id="adminName"
            value={form.adminName}
            onChange={(v) => setForm({ ...form, adminName: v })}
          />
          <Field
            label="CPF (opcional)"
            id="adminCpf"
            value={form.adminCpf}
            onChange={(v) => setForm({ ...form, adminCpf: v })}
            inputMode="numeric"
          />

          {error && (
            <div
              role="alert"
              className="rounded-md border border-[color:var(--ev-danger)] bg-[color:var(--ev-surface)] p-3 text-sm text-[color:var(--ev-danger)]"
            >
              {error}
            </div>
          )}

          <NavButtons
            onBack={() => setStep('unidade')}
            onNext={handleSubmit}
            nextLabel={submitting ? 'Criando…' : 'Criar tenant'}
            nextDisabled={!form.adminEmail || !form.adminName || submitting}
          />
        </fieldset>
      )}
    </section>
  )
}

interface FieldProps {
  label: string
  id: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  required?: boolean
  type?: string
  placeholder?: string
  inputMode?: 'numeric' | 'email' | 'tel'
  maxLength?: number
  hint?: string
  className?: string
}

function Field({
  label,
  id,
  value,
  onChange,
  onBlur,
  required,
  type = 'text',
  placeholder,
  inputMode,
  maxLength,
  hint,
  className,
}: FieldProps) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-[color:var(--ev-danger)]">*</span>}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete="off"
        className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
        style={{ minHeight: 'var(--ev-input-min, 48px)' }}
      />
      {hint && <p className="text-xs text-[color:var(--ev-text-muted)]">{hint}</p>}
    </div>
  )
}

function NavButtons({
  onBack,
  onNext,
  nextLabel = 'Continuar',
  nextDisabled,
}: {
  onBack?: () => void
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
}) {
  return (
    <div className="flex gap-3 pt-2">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-3 text-base font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Voltar
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="flex-1 rounded-md bg-[color:var(--ev-primary)] px-4 py-3 text-base font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
        style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
      >
        {nextLabel}
      </button>
    </div>
  )
}
