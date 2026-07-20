'use client'

/**
 * Edição inline dos dados fiscais da empresa (IE, IM, regime tributário).
 *
 * Estes campos só existiam na criação da filial — depois, corrigir exigia
 * mexer no banco. Como a inscrição municipal é exigida pra NFS-e na maior
 * parte dos municípios, a ausência desta tela travava o onboarding fiscal
 * sem dar caminho ao operador.
 */
import { toast } from '@repo/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { updateCompanyFiscal } from './actions'

const REGIMES = [
  { value: '', label: '— não informado —' },
  { value: 'simples', label: 'Simples Nacional' },
  { value: 'presumido', label: 'Lucro Presumido' },
  { value: 'real', label: 'Lucro Real' },
  { value: 'mei', label: 'MEI' },
] as const

export function CompanyFiscalEdit({
  companyId,
  initialIe,
  initialIm,
  initialRegime,
}: {
  companyId: string
  initialIe: string | null
  initialIm: string | null
  initialRegime: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [ie, setIe] = useState(initialIe ?? '')
  const [im, setIm] = useState(initialIm ?? '')
  const [regime, setRegime] = useState(initialRegime ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const r = await updateCompanyFiscal({
        companyId,
        ie: ie.trim() || null,
        im: im.trim() || null,
        regimeTributario: (regime || null) as 'simples' | 'presumido' | 'real' | 'mei' | null,
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
      toast.success('Dados fiscais atualizados.')
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
        Editar dados fiscais
      </button>
    )

  return (
    <form onSubmit={handleSave} className="ev-stack" style={{ gap: 'var(--ev-space-sm)' }}>
      <div className="flex flex-wrap gap-2">
        <div className="space-y-1">
          <label htmlFor={`ie-${companyId}`} className="text-xs font-medium">
            Inscrição Estadual
          </label>
          <input
            id={`ie-${companyId}`}
            className="ev-input"
            value={ie}
            onChange={(e) => setIe(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`im-${companyId}`} className="text-xs font-medium">
            Inscrição Municipal
          </label>
          <input
            id={`im-${companyId}`}
            className="ev-input"
            value={im}
            onChange={(e) => setIm(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`regime-${companyId}`} className="text-xs font-medium">
            Regime tributário
          </label>
          <select
            id={`regime-${companyId}`}
            className="ev-input"
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

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="ev-btn ev-btn-primary ev-btn-sm" disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar'}
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
