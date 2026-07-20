'use client'

/**
 * Cadastro completo da empresa — identificação, contato, endereço, dados
 * fiscais e habilitações.
 *
 * Cobre exatamente o que o cadastro de empresa na Focus NFe exige. Até aqui
 * endereço, e-mail e telefone existiam no schema mas não tinham tela: o
 * onboarding fiscal pedia dados que não havia onde digitar (2026-07-20).
 */
import { toast } from '@repo/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { updateCompanyRegistration } from './actions'

const REGIMES = [
  { value: '', label: '— não informado —' },
  { value: 'simples', label: 'Simples Nacional' },
  { value: 'presumido', label: 'Lucro Presumido' },
  { value: 'real', label: 'Lucro Real' },
  { value: 'mei', label: 'MEI' },
] as const

export interface CompanyAddress {
  cep?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  cidade?: string
  uf?: string
}

export interface CompanyRegistrationInitial {
  companyId: string
  name: string
  displayName: string | null
  email: string | null
  phone: string | null
  address: CompanyAddress | null
  ie: string | null
  im: string | null
  regime: string | null
  habilitaNfse: boolean
  habilitaNfe: boolean
  habilitaNfce: boolean
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  width = '14rem',
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  width?: string
}) {
  return (
    <div className="space-y-1" style={{ flex: `1 1 ${width}`, minWidth: '10rem' }}>
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="ev-input w-full"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function CompanyRegistrationEdit({ initial }: { initial: CompanyRegistrationInitial }) {
  const router = useRouter()
  const id = initial.companyId
  const [open, setOpen] = useState(false)
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
    ie: initial.ie ?? '',
    im: initial.im ?? '',
    regime: initial.regime ?? '',
    habilitaNfse: initial.habilitaNfse,
    habilitaNfe: initial.habilitaNfe,
    habilitaNfce: initial.habilitaNfce,
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const r = await updateCompanyRegistration({
        companyId: id,
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
        ie: form.ie.trim() || null,
        im: form.im.trim() || null,
        regimeTributario: (form.regime || null) as 'simples' | 'presumido' | 'real' | 'mei' | null,
        habilitaNfse: form.habilitaNfse,
        habilitaNfe: form.habilitaNfe,
        habilitaNfce: form.habilitaNfce,
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
      toast.success('Cadastro da empresa atualizado.')
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setPending(false)
    }
  }

  if (!open)
    return (
      <button type="button" className="ev-btn ev-btn-sm" onClick={() => setOpen(true)}>
        Editar cadastro
      </button>
    )

  return (
    <form onSubmit={handleSave} className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      <fieldset className="ev-stack" style={{ border: 0, padding: 0, gap: 'var(--ev-space-sm)' }}>
        <legend className="text-sm font-semibold">Identificação e contato</legend>
        <div className="flex flex-wrap gap-2">
          <Field
            id={`name-${id}`}
            label="Razão social"
            value={form.name}
            onChange={(v) => set({ name: v })}
            width="20rem"
          />
          <Field
            id={`fantasia-${id}`}
            label="Nome fantasia"
            value={form.displayName}
            onChange={(v) => set({ displayName: v })}
            width="16rem"
          />
          <Field
            id={`email-${id}`}
            label="E-mail"
            type="email"
            value={form.email}
            onChange={(v) => set({ email: v })}
            width="16rem"
          />
          <Field
            id={`phone-${id}`}
            label="Telefone"
            value={form.phone}
            onChange={(v) => set({ phone: v })}
            width="10rem"
          />
        </div>
        <p className="text-xs" style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
          O e-mail é obrigatório no cadastro da Focus NFe.
        </p>
      </fieldset>

      <fieldset className="ev-stack" style={{ border: 0, padding: 0, gap: 'var(--ev-space-sm)' }}>
        <legend className="text-sm font-semibold">Endereço fiscal</legend>
        <div className="flex flex-wrap gap-2">
          <Field
            id={`cep-${id}`}
            label="CEP"
            value={form.cep}
            onChange={(v) => set({ cep: v })}
            width="8rem"
          />
          <Field
            id={`logradouro-${id}`}
            label="Logradouro"
            value={form.logradouro}
            onChange={(v) => set({ logradouro: v })}
            width="20rem"
          />
          <Field
            id={`numero-${id}`}
            label="Número"
            value={form.numero}
            onChange={(v) => set({ numero: v })}
            width="7rem"
          />
          <Field
            id={`complemento-${id}`}
            label="Complemento"
            value={form.complemento}
            onChange={(v) => set({ complemento: v })}
            width="12rem"
          />
          <Field
            id={`bairro-${id}`}
            label="Bairro"
            value={form.bairro}
            onChange={(v) => set({ bairro: v })}
            width="12rem"
          />
          <Field
            id={`cidade-${id}`}
            label="Cidade"
            value={form.cidade}
            onChange={(v) => set({ cidade: v })}
            width="12rem"
          />
          <Field
            id={`uf-${id}`}
            label="UF"
            value={form.uf}
            onChange={(v) => set({ uf: v })}
            width="5rem"
          />
        </div>
        <p className="text-xs" style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
          É o endereço do CNPJ, não o da unidade onde o serviço é prestado.
        </p>
      </fieldset>

      <fieldset className="ev-stack" style={{ border: 0, padding: 0, gap: 'var(--ev-space-sm)' }}>
        <legend className="text-sm font-semibold">Dados fiscais</legend>
        <div className="flex flex-wrap gap-2">
          <Field
            id={`ie-${id}`}
            label="Inscrição Estadual"
            value={form.ie}
            onChange={(v) => set({ ie: v })}
            width="12rem"
          />
          <Field
            id={`im-${id}`}
            label="Inscrição Municipal"
            value={form.im}
            onChange={(v) => set({ im: v })}
            width="12rem"
          />
          <div className="space-y-1" style={{ flex: '1 1 12rem', minWidth: '10rem' }}>
            <label htmlFor={`regime-${id}`} className="text-xs font-medium">
              Regime tributário
            </label>
            <select
              id={`regime-${id}`}
              className="ev-input w-full"
              value={form.regime}
              onChange={(e) => set({ regime: e.target.value })}
            >
              {REGIMES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className="ev-stack" style={{ border: 0, padding: 0, gap: 'var(--ev-space-sm)' }}>
        <legend className="text-sm font-semibold">Documentos que esta empresa emite</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm" htmlFor={`hnfse-${id}`}>
            <input
              id={`hnfse-${id}`}
              type="checkbox"
              checked={form.habilitaNfse}
              onChange={(e) => set({ habilitaNfse: e.target.checked })}
            />
            NFS-e (serviço)
          </label>
          <label className="flex items-center gap-2 text-sm" htmlFor={`hnfe-${id}`}>
            <input
              id={`hnfe-${id}`}
              type="checkbox"
              checked={form.habilitaNfe}
              onChange={(e) => set({ habilitaNfe: e.target.checked })}
            />
            NF-e (produto)
          </label>
          <label className="flex items-center gap-2 text-sm" htmlFor={`hnfce-${id}`}>
            <input
              id={`hnfce-${id}`}
              type="checkbox"
              checked={form.habilitaNfce}
              onChange={(e) => set({ habilitaNfce: e.target.checked })}
            />
            NFC-e (varejo)
          </label>
        </div>
        <p className="text-xs" style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
          Habilitar emissão que a empresa não usa cria exposição fiscal sem contrapartida.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="ev-btn ev-btn-primary ev-btn-sm" disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar cadastro'}
        </button>
        <button
          type="button"
          className="ev-btn ev-btn-ghost ev-btn-sm"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancelar
        </button>
        {error && (
          <span role="alert" className="text-xs" style={{ color: 'var(--ev-danger, #dc2626)' }}>
            {error}
          </span>
        )}
      </div>
    </form>
  )
}
