'use client'

/**
 * Dados fiscais da empresa — inscrições, regime e habilitações.
 *
 * Identidade, contato e endereço **não aparecem aqui**, nem como campo nem por
 * composição: são de `persons` (ADR 0047 / regra 22) e editados em
 * `/app/pessoas/[id]`. Esta tela mostra só um resumo com link.
 *
 * Duas iterações levaram até aqui. A primeira recriou os inputs (duplicação de
 * código). A segunda compôs `<PersonForm>` — resolveu o código, mas o operador
 * continuava vendo os mesmos campos em duas telas e perguntando qual era a
 * certa. Campo repetido confunde mesmo quando o código não está duplicado.
 */
import { isAddressFiscallyComplete } from '@repo/types'
import { toast } from '@repo/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { PersonAddress } from '../../pessoas/person-form'
import { updateCompanyFiscal } from './actions'

const REGIMES = [
  { value: '', label: '— não informado —' },
  { value: 'simples', label: 'Simples Nacional' },
  { value: 'presumido', label: 'Lucro Presumido' },
  { value: 'real', label: 'Lucro Real' },
  { value: 'mei', label: 'MEI' },
] as const

export type CompanyAddress = PersonAddress

/** Resumo de uma linha; sinaliza quando falta o que a emissão fiscal exige. */
function enderecoResumo(address: PersonAddress | null): string {
  if (!address) return 'Endereço não informado — necessário para emitir nota'
  const linha = [address.logradouro, address.numero, address.bairro, address.cidade, address.uf]
    .filter(Boolean)
    .join(', ')
  if (!isAddressFiscallyComplete(address)) return `${linha || 'Endereço incompleto'} (incompleto)`
  return linha
}

export interface CompanyRegistrationInitial {
  companyId: string
  personId: string
  name: string
  displayName: string | null
  email: string | null
  phone: string | null
  address: PersonAddress | null
  ie: string | null
  im: string | null
  regime: string | null
  habilitaNfse: boolean
  habilitaNfe: boolean
  habilitaNfce: boolean
}

export function CompanyRegistrationEdit({ initial }: { initial: CompanyRegistrationInitial }) {
  const router = useRouter()
  const id = initial.companyId
  const [open, setOpen] = useState(false)
  const [ie, setIe] = useState(initial.ie ?? '')
  const [im, setIm] = useState(initial.im ?? '')
  const [regime, setRegime] = useState(initial.regime ?? '')
  const [habilitaNfse, setHabilitaNfse] = useState(initial.habilitaNfse)
  const [habilitaNfe, setHabilitaNfe] = useState(initial.habilitaNfe)
  const [habilitaNfce, setHabilitaNfce] = useState(initial.habilitaNfce)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSaveFiscal(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const r = await updateCompanyFiscal({
        companyId: id,
        ie: ie.trim() || null,
        im: im.trim() || null,
        regimeTributario: (regime || null) as 'simples' | 'presumido' | 'real' | 'mei' | null,
        habilitaNfse,
        habilitaNfe,
        habilitaNfce,
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
      toast.success('Dados fiscais atualizados.')
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
    <div className="ev-stack" style={{ gap: 'var(--ev-space-lg)' }}>
      {/* Apontamento, não cópia: identidade, contato e endereço são editados
          em Pessoas — repetir os campos aqui criaria uma segunda superfície
          escrevendo o mesmo dado. */}
      <div
        className="ev-card"
        style={{ padding: 'var(--ev-space-md)', display: 'grid', gap: 'var(--ev-space-xs)' }}
      >
        <span className="text-sm font-semibold">Dados cadastrais</span>
        <span className="text-sm">
          {initial.displayName ? `${initial.name} · ${initial.displayName}` : initial.name}
        </span>
        <span className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
          {initial.email ?? 'sem e-mail'}
          {' · '}
          {initial.phone ?? 'sem telefone'}
        </span>
        <span className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
          {enderecoResumo(initial.address)}
        </span>
        <Link href={`/app/pessoas/${initial.personId}`} className="ev-btn ev-btn-sm">
          Editar dados cadastrais em Pessoas →
        </Link>
      </div>

      <form onSubmit={handleSaveFiscal} className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
        <fieldset className="ev-stack" style={{ border: 0, padding: 0, gap: 'var(--ev-space-sm)' }}>
          <legend className="text-sm font-semibold">Dados fiscais</legend>
          <div className="flex flex-wrap gap-2">
            <div className="space-y-1" style={{ flex: '1 1 12rem', minWidth: '9rem' }}>
              <label htmlFor={`ie-${id}`} className="text-xs font-medium">
                Inscrição Estadual
              </label>
              <input
                id={`ie-${id}`}
                className="ev-input w-full"
                value={ie}
                onChange={(e) => setIe(e.target.value)}
              />
            </div>
            <div className="space-y-1" style={{ flex: '1 1 12rem', minWidth: '9rem' }}>
              <label htmlFor={`im-${id}`} className="text-xs font-medium">
                Inscrição Municipal
              </label>
              <input
                id={`im-${id}`}
                className="ev-input w-full"
                value={im}
                onChange={(e) => setIm(e.target.value)}
              />
            </div>
            <div className="space-y-1" style={{ flex: '1 1 12rem', minWidth: '9rem' }}>
              <label htmlFor={`regime-${id}`} className="text-xs font-medium">
                Regime tributário
              </label>
              <select
                id={`regime-${id}`}
                className="ev-input w-full"
                value={regime}
                onChange={(e) => setRegime(e.target.value)}
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
                checked={habilitaNfse}
                onChange={(e) => setHabilitaNfse(e.target.checked)}
              />
              NFS-e (serviço)
            </label>
            <label className="flex items-center gap-2 text-sm" htmlFor={`hnfe-${id}`}>
              <input
                id={`hnfe-${id}`}
                type="checkbox"
                checked={habilitaNfe}
                onChange={(e) => setHabilitaNfe(e.target.checked)}
              />
              NF-e (produto)
            </label>
            <label className="flex items-center gap-2 text-sm" htmlFor={`hnfce-${id}`}>
              <input
                id={`hnfce-${id}`}
                type="checkbox"
                checked={habilitaNfce}
                onChange={(e) => setHabilitaNfce(e.target.checked)}
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
            {pending ? 'Salvando…' : 'Salvar dados fiscais'}
          </button>
          <button
            type="button"
            className="ev-btn ev-btn-ghost ev-btn-sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Fechar
          </button>
          {error && (
            <span role="alert" className="text-xs" style={{ color: 'var(--ev-danger, #dc2626)' }}>
              {error}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
