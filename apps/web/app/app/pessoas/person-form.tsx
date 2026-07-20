'use client'

/**
 * Formulário de identidade, contato e endereço de uma pessoa.
 *
 * **Fonte única desses campos.** Toda entidade especializada (empresa, member,
 * fornecedor) aponta pra `persons` (ADR 0047 / regra 22), então telas
 * especializadas devem **compor este componente** em vez de recriar os campos —
 * duas superfícies escrevendo os mesmos dados divergem em máscara e validação.
 *
 * `document` fica de fora: mudar CPF/CNPJ de pessoa já vinculada reescreveria a
 * identidade de tudo que aponta pra ela.
 */
import { toast } from '@repo/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { updatePerson } from './actions'

export interface PersonAddress {
  cep?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  cidade?: string
  uf?: string
}

export interface PersonFormInitial {
  id: string
  name: string
  displayName: string | null
  email: string | null
  phone: string | null
  address: PersonAddress | null
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  width = '14rem',
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  width?: string
}) {
  return (
    <div className="space-y-1" style={{ flex: `1 1 ${width}`, minWidth: '9rem' }}>
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="ev-input w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function PersonForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: PersonFormInitial
  onSaved?: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const pid = initial.id
  const [form, setForm] = useState({
    name: initial.name,
    displayName: initial.displayName ?? '',
    email: initial.email ?? '',
    phone: initial.phone ?? '',
    cep: initial.address?.cep ?? '',
    logradouro: initial.address?.logradouro ?? '',
    numero: initial.address?.numero ?? '',
    complemento: initial.address?.complemento ?? '',
    bairro: initial.address?.bairro ?? '',
    cidade: initial.address?.cidade ?? '',
    uf: initial.address?.uf ?? '',
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const r = await updatePerson({
        id: pid,
        name: form.name.trim(),
        displayName: form.displayName.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: {
          cep: form.cep.trim() || undefined,
          logradouro: form.logradouro.trim() || undefined,
          numero: form.numero.trim() || undefined,
          complemento: form.complemento.trim() || undefined,
          bairro: form.bairro.trim() || undefined,
          cidade: form.cidade.trim() || undefined,
          uf: form.uf.trim().toUpperCase() || undefined,
        },
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
      toast.success('Dados cadastrais atualizados.')
      onSaved?.()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      <fieldset className="ev-stack" style={{ border: 0, padding: 0, gap: 'var(--ev-space-sm)' }}>
        <legend className="text-sm font-semibold">Identificação e contato</legend>
        <div className="flex flex-wrap gap-2">
          <Field
            id={`p-name-${pid}`}
            label="Nome / Razão social"
            value={form.name}
            onChange={(v) => set({ name: v })}
            width="20rem"
          />
          <Field
            id={`p-fantasia-${pid}`}
            label="Nome fantasia / apelido"
            value={form.displayName}
            onChange={(v) => set({ displayName: v })}
            width="16rem"
          />
          <Field
            id={`p-email-${pid}`}
            label="E-mail"
            type="email"
            value={form.email}
            onChange={(v) => set({ email: v })}
            width="16rem"
          />
          <Field
            id={`p-phone-${pid}`}
            label="Telefone"
            value={form.phone}
            onChange={(v) => set({ phone: v })}
            width="10rem"
          />
        </div>
      </fieldset>

      <fieldset className="ev-stack" style={{ border: 0, padding: 0, gap: 'var(--ev-space-sm)' }}>
        <legend className="text-sm font-semibold">Endereço</legend>
        <div className="flex flex-wrap gap-2">
          <Field
            id={`p-cep-${pid}`}
            label="CEP"
            value={form.cep}
            onChange={(v) => set({ cep: v })}
            width="8rem"
          />
          <Field
            id={`p-logradouro-${pid}`}
            label="Logradouro"
            value={form.logradouro}
            onChange={(v) => set({ logradouro: v })}
            width="20rem"
          />
          <Field
            id={`p-numero-${pid}`}
            label="Número"
            value={form.numero}
            onChange={(v) => set({ numero: v })}
            width="7rem"
          />
          <Field
            id={`p-complemento-${pid}`}
            label="Complemento"
            value={form.complemento}
            onChange={(v) => set({ complemento: v })}
            width="12rem"
          />
          <Field
            id={`p-bairro-${pid}`}
            label="Bairro"
            value={form.bairro}
            onChange={(v) => set({ bairro: v })}
            width="12rem"
          />
          <Field
            id={`p-cidade-${pid}`}
            label="Cidade"
            value={form.cidade}
            onChange={(v) => set({ cidade: v })}
            width="12rem"
          />
          <Field
            id={`p-uf-${pid}`}
            label="UF"
            value={form.uf}
            onChange={(v) => set({ uf: v })}
            width="5rem"
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="ev-btn ev-btn-primary ev-btn-sm" disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar dados cadastrais'}
        </button>
        {onCancel && (
          <button
            type="button"
            className="ev-btn ev-btn-ghost ev-btn-sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancelar
          </button>
        )}
        {error && (
          <span role="alert" className="text-xs" style={{ color: 'var(--ev-danger, #dc2626)' }}>
            {error}
          </span>
        )}
      </div>
    </form>
  )
}
