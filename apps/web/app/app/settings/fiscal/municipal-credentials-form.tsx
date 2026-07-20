'use client'

/**
 * Credenciais do portal municipal — repasse pra Focus NFe (ADR 0105).
 *
 * Existe porque o painel da Focus nem sempre expõe os campos
 * `login_responsavel` / `senha_responsavel`, e sem eles vários municípios
 * (Cascavel/PR entre eles) recusam a emissão com `empresa_nao_habilitada`.
 *
 * A senha **não é armazenada pelo LogiFit** — vai direto pra Focus, que precisa
 * dela pra logar no portal da prefeitura, e é descartada aqui. O formulário
 * deixa isso explícito pro operador em vez de deixar implícito.
 */
import { toast } from '@repo/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { saveMunicipalCredentials } from './actions'

export interface MunicipalCompanyOption {
  id: string
  name: string
  /** Série de RPS exigida pelo município, quando conhecida (perfil em @repo/ai) */
  suggestedSerie: number | null
  municipalityLabel: string | null
  configuredAt: string | null
}

export function MunicipalCredentialsForm({
  companies,
}: {
  companies: MunicipalCompanyOption[]
}) {
  const router = useRouter()
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const selected = companies.find((c) => c.id === companyId)
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [im, setIm] = useState('')
  const [serie, setSerie] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveSerie = serie || (selected?.suggestedSerie ? String(selected.suggestedSerie) : '')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const r = await saveMunicipalCredentials({
        companyId,
        loginPrefeitura: login.trim(),
        senhaPrefeitura: senha,
        inscricaoMunicipal: im.trim() || undefined,
        serieRps: effectiveSerie ? Number.parseInt(effectiveSerie, 10) : undefined,
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      // A senha some da memória do formulário assim que cumpre seu papel.
      setSenha('')
      // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
      toast.success('Credenciais do município enviadas à Focus NFe.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar credenciais')
    } finally {
      setPending(false)
    }
  }

  if (companies.length === 0) return null

  return (
    <form onSubmit={handleSubmit} className="ev-stack" style={{ gap: 'var(--ev-space-sm)' }}>
      <p style={{ margin: 0, color: 'var(--ev-text-muted)' }}>
        Vários municípios exigem o login do portal da prefeitura para transmitir a nota — o
        certificado digital não substitui. Estes dados vão direto para a sua conta Focus NFe;{' '}
        <strong>o LogiFit não armazena a senha</strong>.
      </p>

      <label htmlFor="mc-company">Empresa</label>
      <select
        id="mc-company"
        className="ev-input"
        value={companyId}
        onChange={(e) => setCompanyId(e.target.value)}
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.configuredAt ? ` · configurado em ${c.configuredAt}` : ''}
          </option>
        ))}
      </select>

      {selected?.municipalityLabel && (
        <p style={{ margin: 0, color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-sm)' }}>
          Município: {selected.municipalityLabel}
        </p>
      )}

      <label htmlFor="mc-login">Login do portal da prefeitura</label>
      <input
        id="mc-login"
        className="ev-input"
        value={login}
        onChange={(e) => setLogin(e.target.value)}
        autoComplete="off"
        required
      />

      <label htmlFor="mc-senha">Senha do portal da prefeitura</label>
      <input
        id="mc-senha"
        className="ev-input"
        type="password"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        autoComplete="new-password"
        required
      />

      <label htmlFor="mc-im">Inscrição municipal (opcional)</label>
      <input
        id="mc-im"
        className="ev-input"
        value={im}
        onChange={(e) => setIm(e.target.value)}
        inputMode="numeric"
      />

      <label htmlFor="mc-serie">
        Série do RPS (opcional
        {selected?.suggestedSerie ? ` — o município usa a série ${selected.suggestedSerie}` : ''})
      </label>
      <input
        id="mc-serie"
        className="ev-input"
        value={effectiveSerie}
        onChange={(e) => setSerie(e.target.value)}
        inputMode="numeric"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="ev-btn ev-btn-primary"
          disabled={pending || !companyId || !login.trim() || !senha}
        >
          {pending ? 'Enviando…' : 'Enviar à Focus NFe'}
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
