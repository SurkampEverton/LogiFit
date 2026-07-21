'use client'

/**
 * Form + tabela do catálogo de serviços — Sprint 36b.3 (ADR 0059).
 *
 * Alíquota ISS exibida em % com 2 casas mas armazenada em basis points
 * (200 = 2,00%) — conversão só na borda da UI. Sem delete físico: toggle
 * ativa/desativa preservando histórico.
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { saveServiceCatalogItem, toggleServiceCatalogItem } from './actions'

interface ServiceRow {
  id: string
  companyId: string
  companyName: string
  municipalityCode: string
  lc116Code: string | null
  codigoTributacaoNacional: string | null
  cnae: string | null
  description: string
  taxRegime: 'simples_nacional' | 'lucro_presumido' | 'lucro_real' | 'mei'
  issRateBp: number
  active: boolean
}

const REGIME_LABEL: Record<ServiceRow['taxRegime'], string> = {
  simples_nacional: 'Simples Nacional',
  lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real',
  mei: 'MEI',
}

const EMPTY_FORM = {
  id: undefined as string | undefined,
  companyId: '',
  municipalityCode: '',
  lc116Code: '',
  codigoTributacaoNacional: '',
  cnae: '',
  description: '',
  taxRegime: 'simples_nacional' as ServiceRow['taxRegime'],
  issRatePercent: '2.00',
}

export function CatalogManager({
  companies,
  services,
}: {
  companies: Array<{ id: string; name: string }>
  services: ServiceRow[]
}) {
  const router = useRouter()
  const [form, setForm] = useState({ ...EMPTY_FORM, companyId: companies[0]?.id ?? '' })
  const [pending, setPending] = useState<'save' | string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function startEdit(row: ServiceRow) {
    setForm({
      id: row.id,
      companyId: row.companyId,
      municipalityCode: row.municipalityCode,
      lc116Code: row.lc116Code ?? '',
      codigoTributacaoNacional: row.codigoTributacaoNacional ?? '',
      cnae: row.cnae ?? '',
      description: row.description,
      taxRegime: row.taxRegime,
      issRatePercent: (row.issRateBp / 100).toFixed(2),
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    setPending('save')
    setError(null)
    try {
      const issRateBp = Math.round(Number.parseFloat(form.issRatePercent) * 100)
      if (!Number.isFinite(issRateBp)) throw new Error('Alíquota ISS inválida')
      const r = await saveServiceCatalogItem({
        id: form.id,
        companyId: form.companyId,
        municipalityCode: form.municipalityCode.replace(/\D/g, ''),
        lc116Code: form.lc116Code.trim() || null,
        codigoTributacaoNacional: form.codigoTributacaoNacional.trim() || null,
        cnae: form.cnae.trim() || null,
        description: form.description.trim(),
        taxRegime: form.taxRegime,
        issRateBp,
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      setForm({ ...EMPTY_FORM, companyId: companies[0]?.id ?? '' })
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar serviço')
    } finally {
      setPending(null)
    }
  }

  async function handleToggle(row: ServiceRow) {
    setPending(row.id)
    setError(null)
    try {
      const r = await toggleServiceCatalogItem({ id: row.id })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao alterar serviço')
    } finally {
      setPending(null)
    }
  }

  return (
    <>
      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>{form.id ? 'Editar serviço' : 'Novo serviço'}</h2>
        <form
          onSubmit={handleSave}
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', maxWidth: '60rem' }}
        >
          <div className="space-y-1">
            <label htmlFor="svc-company" className="text-sm font-medium">
              Empresa (emitente)
            </label>
            <select
              id="svc-company"
              className="ev-input w-full"
              value={form.companyId}
              onChange={(e) => setForm({ ...form, companyId: e.target.value })}
              required
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="svc-description" className="text-sm font-medium">
              Descrição
            </label>
            <input
              id="svc-description"
              className="ev-input w-full"
              placeholder="Mensalidade academia"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
              minLength={3}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="svc-municipality" className="text-sm font-medium">
              Município (código IBGE, 7 dígitos)
            </label>
            <input
              id="svc-municipality"
              className="ev-input w-full"
              placeholder="3550308 (São Paulo)"
              value={form.municipalityCode}
              onChange={(e) => setForm({ ...form, municipalityCode: e.target.value })}
              required
              pattern="\d{7}"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="svc-lc116" className="text-sm font-medium">
              Item LC 116/2003
            </label>
            <input
              id="svc-lc116"
              className="ev-input w-full"
              placeholder="8.02 (ensino/treinamento)"
              value={form.lc116Code}
              onChange={(e) => setForm({ ...form, lc116Code: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="svc-codigo-nacional" className="text-sm font-medium">
              Código de Tributação Nacional
            </label>
            <input
              id="svc-codigo-nacional"
              className="ev-input w-full"
              placeholder="010601 (item + subitem + desdobramento)"
              inputMode="numeric"
              value={form.codigoTributacaoNacional}
              onChange={(e) => setForm({ ...form, codigoTributacaoNacional: e.target.value })}
            />
            <p className="text-xs" style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
              6 dígitos do padrão nacional (item + subitem + desdobramento). Municípios já migrados
              recusam o formato da LC 116. Use o código que aparece em <strong>Lista de Serviço</strong>{' '}
              no cadastro da empresa no portal da prefeitura: emitir um serviço fora dos habilitados
              na inscrição municipal é recusado.
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="svc-cnae" className="text-sm font-medium">
              CNAE (opcional)
            </label>
            <input
              id="svc-cnae"
              className="ev-input w-full"
              placeholder="8591-1/00"
              value={form.cnae}
              onChange={(e) => setForm({ ...form, cnae: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="svc-regime" className="text-sm font-medium">
              Regime tributário
            </label>
            <select
              id="svc-regime"
              className="ev-input w-full"
              value={form.taxRegime}
              onChange={(e) =>
                setForm({ ...form, taxRegime: e.target.value as ServiceRow['taxRegime'] })
              }
            >
              {Object.entries(REGIME_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="svc-iss" className="text-sm font-medium">
              Alíquota ISS (%)
            </label>
            <input
              id="svc-iss"
              className="ev-input w-full"
              type="number"
              step="0.01"
              min="2"
              max="5"
              value={form.issRatePercent}
              onChange={(e) => setForm({ ...form, issRatePercent: e.target.value })}
              required
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="ev-btn ev-btn-primary"
              disabled={pending !== null || !form.companyId}
            >
              {pending === 'save' ? 'Salvando…' : form.id ? 'Atualizar' : 'Adicionar serviço'}
            </button>
            {form.id && (
              <button
                type="button"
                className="ev-btn"
                onClick={() => setForm({ ...EMPTY_FORM, companyId: companies[0]?.id ?? '' })}
              >
                Cancelar edição
              </button>
            )}
          </div>
        </form>
        {error && (
          <p
            className="text-xs"
            role="alert"
            style={{ marginTop: '0.5rem', color: 'var(--ev-danger, #dc2626)' }}
          >
            {error}
          </p>
        )}
      </section>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>Serviços cadastrados</h2>
        {services.length === 0 ? (
          <p style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
            Nenhum serviço ainda — cadastre o primeiro acima pra habilitar emissão de NFS-e.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ev-table w-full">
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th>Empresa</th>
                  <th>Município</th>
                  <th>LC 116</th>
                  <th>Cód. nacional</th>
                  <th>Regime</th>
                  <th>ISS</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {services.map((row) => (
                  <tr key={row.id} style={{ opacity: row.active ? 1 : 0.55 }}>
                    <td>{row.description}</td>
                    <td>{row.companyName}</td>
                    <td>
                      <code style={{ fontSize: '0.8rem' }}>{row.municipalityCode}</code>
                    </td>
                    <td>{row.lc116Code ?? '—'}</td>
                    <td>{row.codigoTributacaoNacional ?? '—'}</td>
                    <td>{REGIME_LABEL[row.taxRegime]}</td>
                    <td>{(row.issRateBp / 100).toFixed(2)}%</td>
                    <td>{row.active ? 'Ativo' : 'Inativo'}</td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="ev-btn ev-btn-ghost ev-btn-sm"
                          onClick={() => startEdit(row)}
                          disabled={pending !== null}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="ev-btn ev-btn-ghost ev-btn-sm"
                          onClick={() => void handleToggle(row)}
                          disabled={pending !== null}
                        >
                          {pending === row.id ? '…' : row.active ? 'Desativar' : 'Reativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
