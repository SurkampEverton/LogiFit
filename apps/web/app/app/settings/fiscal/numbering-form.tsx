'use client'

/**
 * Séries e numeração — configuração direta na tela fiscal.
 *
 * Antes a sequência só nascia na primeira emissão, sempre em 1, e o passo era
 * read-only. Quem migra de outro sistema precisa continuar de onde parou: quem
 * já emitiu até a 4.312 começa da 4.313, não do 1.
 */
import { toast } from '@repo/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { setNumberingSequence } from './actions'

const KINDS = [
  { value: 'nfse', label: 'NFS-e (serviço)' },
  { value: 'nfe', label: 'NF-e (produto)' },
  { value: 'nfce', label: 'NFC-e (varejo)' },
  { value: 'nfe_return', label: 'NF-e devolução' },
  { value: 'nfe_transfer', label: 'NF-e transferência' },
  { value: 'nfe_conserto_out', label: 'NF-e remessa conserto' },
  { value: 'nfe_conserto_return', label: 'NF-e retorno conserto' },
  { value: 'nfe_self_entry', label: 'NF-e entrada própria' },
] as const

export interface NumberingRow {
  /** Numeração é por empresa: sem o nome, duas linhas iguais se confundem */
  companyName: string
  kind: string
  serie: number
  nextNumero: number
  environment: string
}

export function NumberingForm({
  companies,
  rows,
  suggestedSerie,
}: {
  companies: Array<{ id: string; name: string }>
  rows: NumberingRow[]
  /** Série que o município espera, quando conhecida (perfil em @repo/ai) */
  suggestedSerie: number | null
}) {
  const router = useRouter()
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [kind, setKind] = useState<string>('nfse')
  const [serie, setSerie] = useState(suggestedSerie ? String(suggestedSerie) : '1')
  const [environment, setEnvironment] = useState('producao')
  const [nextNumero, setNextNumero] = useState('1')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const r = await setNumberingSequence({
        companyId,
        kind: kind as 'nfse',
        serie: Number.parseInt(serie, 10),
        environment: environment as 'homologacao' | 'producao',
        nextNumero: Number.parseInt(nextNumero, 10),
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
      toast.success('Numeração atualizada.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar numeração')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      {rows.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {rows.map((n) => (
            <li key={`${n.companyName}-${n.kind}-${n.serie}-${n.environment}`}>
              <strong>{n.companyName}</strong> · {n.kind} série {n.serie} · próximo nº:{' '}
              {n.nextNumero} · {n.environment}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSave} className="ev-stack" style={{ gap: 'var(--ev-space-sm)' }}>
        <div className="flex flex-wrap gap-2">
          <div className="space-y-1" style={{ flex: '1 1 14rem', minWidth: '10rem' }}>
            <label htmlFor="num-company" className="text-xs font-medium">
              Empresa
            </label>
            <select
              id="num-company"
              className="ev-input w-full"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1" style={{ flex: '1 1 12rem', minWidth: '10rem' }}>
            <label htmlFor="num-kind" className="text-xs font-medium">
              Documento
            </label>
            <select
              id="num-kind"
              className="ev-input w-full"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1" style={{ flex: '0 1 6rem', minWidth: '5rem' }}>
            <label htmlFor="num-serie" className="text-xs font-medium">
              Série
            </label>
            <input
              id="num-serie"
              className="ev-input w-full"
              inputMode="numeric"
              value={serie}
              onChange={(e) => setSerie(e.target.value)}
            />
          </div>
          <div className="space-y-1" style={{ flex: '1 1 10rem', minWidth: '9rem' }}>
            <label htmlFor="num-env" className="text-xs font-medium">
              Ambiente
            </label>
            <select
              id="num-env"
              className="ev-input w-full"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
            >
              <option value="producao">produção</option>
              <option value="homologacao">homologação</option>
            </select>
          </div>
          <div className="space-y-1" style={{ flex: '0 1 8rem', minWidth: '7rem' }}>
            <label htmlFor="num-next" className="text-xs font-medium">
              Próximo nº
            </label>
            <input
              id="num-next"
              className="ev-input w-full"
              inputMode="numeric"
              value={nextNumero}
              onChange={(e) => setNextNumero(e.target.value)}
            />
          </div>
        </div>

        <p className="text-xs" style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
          {suggestedSerie ? `O município desta empresa usa a série ${suggestedSerie}. ` : ''}
          Só é possível avançar a numeração — repetir um número já emitido gera duplicidade perante
          o fisco.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="ev-btn ev-btn-primary ev-btn-sm"
            disabled={pending || !companyId}
          >
            {pending ? 'Salvando…' : 'Definir numeração'}
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
