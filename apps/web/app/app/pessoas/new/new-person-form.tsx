'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createPerson } from '../actions'

/**
 * Form de criação de pessoa — Sprint 01a Faixa D + expansão 2026-05-21.
 *
 * UX:
 *   - Operador digita documento (CPF/CNPJ) — kind detectado pelos dígitos
 *   - CNPJ (14 dígitos) ao blur → `/api/pessoas/cnpj/{cnpj}` preenche
 *     name/displayName/email/phone/address; alerta se situação ≠ ativa
 *   - CEP (8 dígitos) ao blur → `/api/cep/{cep}` preenche
 *     logradouro/bairro/cidade/uf (não sobrescreve o que operador já digitou)
 *   - Campos PF-only (`birthDate`, `sex`) só aparecem quando documento = CPF
 *   - `sex` é texto livre (LGPD art. 11: não inferir gênero)
 *   - Submit chama Server Action `createPerson`
 *
 * Faixa D fechamento (ainda pendente): PromptDialog confirmação se situação
 * suspensa/baixada, LocaleSwitcher, toast.fromApiError (regra 45).
 */
interface AutoFillState {
  name: string
  displayName: string | null
  email: string | null
  phone: string | null
  address: {
    cep?: string | null
    logradouro?: string | null
    numero?: string | null
    complemento?: string | null
    bairro?: string | null
    cidade?: string | null
    uf?: string | null
  } | null
  situacao: 'ativa' | 'suspensa' | 'baixada' | 'inapta' | 'nula' | 'desconhecida'
}

interface AutoFillStateWithExtra {
  razaoSocial: string
  nomeFantasia: string | null
  email: string | null
  telefone: string | null
  address: AutoFillState['address']
  situacao: AutoFillState['situacao']
}

interface CepLookupData {
  cep: string
  logradouro: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
}

export function NewPersonForm() {
  const router = useRouter()

  // ─── Identidade ────────────────────────────────────────────────────
  const [document, setDocument] = useState('')
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // ─── PF-only ───────────────────────────────────────────────────────
  const [birthDate, setBirthDate] = useState('')
  const [sex, setSex] = useState('')

  // ─── Endereço ──────────────────────────────────────────────────────
  const [cep, setCep] = useState('')
  const [logradouro, setLogradouro] = useState('')
  const [numero, setNumero] = useState('')
  const [complemento, setComplemento] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState('')

  // ─── Observações ───────────────────────────────────────────────────
  const [notes, setNotes] = useState('')

  // ─── Estado UX ─────────────────────────────────────────────────────
  const [autoFilled, setAutoFilled] = useState<AutoFillState | null>(null)
  const [cnpjStatus, setCnpjStatus] = useState<'idle' | 'fetching' | 'ok' | 'error'>('idle')
  const [cnpjMessage, setCnpjMessage] = useState<string | null>(null)
  const [cepStatus, setCepStatus] = useState<'idle' | 'fetching' | 'ok' | 'error'>('idle')
  const [cepMessage, setCepMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const docDigits = document.replace(/\D/g, '')
  const detectedKind = docDigits.length === 11 ? 'pf' : docDigits.length === 14 ? 'pj' : null
  const cepDigits = cep.replace(/\D/g, '')

  async function handleDocumentBlur() {
    if (detectedKind !== 'pj') return
    if (cnpjStatus === 'fetching') return
    setCnpjStatus('fetching')
    setCnpjMessage(null)
    try {
      // safe-fetch-exempt: same-origin /api/pessoas/cnpj — endpoint LogiFit interno
      const res = await fetch(`/api/pessoas/cnpj/${docDigits}`, { cache: 'no-store' })
      const json = (await res.json()) as
        | { ok: true; data: AutoFillStateWithExtra; fromCache: boolean }
        | { ok: false; error: { code: string; message?: string } }
      if (!json.ok) {
        setCnpjStatus('error')
        setCnpjMessage(messageForCnpjError(json.error.code))
        return
      }
      const data = json.data
      setAutoFilled({
        name: data.razaoSocial,
        displayName: data.nomeFantasia ?? null,
        email: data.email,
        phone: data.telefone,
        address: data.address ?? null,
        situacao: data.situacao,
      })
      // Preenche só campos vazios; respeita o que operador já digitou
      if (!name) setName(data.razaoSocial)
      if (!displayName && data.nomeFantasia) setDisplayName(data.nomeFantasia)
      if (!email && data.email) setEmail(data.email)
      if (!phone && data.telefone) setPhone(data.telefone)
      const addr = data.address
      if (addr) {
        if (!cep && addr.cep) setCep(addr.cep)
        if (!logradouro && addr.logradouro) setLogradouro(addr.logradouro)
        if (!numero && addr.numero) setNumero(addr.numero)
        if (!complemento && addr.complemento) setComplemento(addr.complemento)
        if (!bairro && addr.bairro) setBairro(addr.bairro)
        if (!cidade && addr.cidade) setCidade(addr.cidade)
        if (!uf && addr.uf) setUf(addr.uf)
      }
      setCnpjStatus('ok')
    } catch (_err) {
      setCnpjStatus('error')
      setCnpjMessage('Erro de rede ao consultar CNPJ')
    }
  }

  async function handleCepBlur() {
    if (cepDigits.length !== 8) return
    if (cepStatus === 'fetching') return
    setCepStatus('fetching')
    setCepMessage(null)
    try {
      // safe-fetch-exempt: same-origin /api/cep — endpoint LogiFit interno
      const res = await fetch(`/api/cep/${cepDigits}`, { cache: 'no-store' })
      const json = (await res.json()) as
        | { ok: true; data: CepLookupData }
        | { ok: false; error: { code: string; message?: string } }
      if (!json.ok) {
        setCepStatus('error')
        setCepMessage(messageForCepError(json.error.code))
        return
      }
      const d = json.data
      if (!logradouro && d.logradouro) setLogradouro(d.logradouro)
      if (!complemento && d.complemento) setComplemento(d.complemento)
      if (!bairro && d.bairro) setBairro(d.bairro)
      if (!cidade && d.cidade) setCidade(d.cidade)
      if (!uf && d.uf) setUf(d.uf)
      setCepStatus('ok')
    } catch (_err) {
      setCepStatus('error')
      setCepMessage('Erro de rede ao consultar CEP')
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setSubmitError(null)

    const hasAddress = cep || logradouro || numero || complemento || bairro || cidade || uf
    const result = await createPerson({
      document: document || undefined,
      name: name || undefined,
      displayName: displayName || undefined,
      birthDate: detectedKind === 'pf' && birthDate ? birthDate : undefined,
      sex: detectedKind === 'pf' && sex ? sex : undefined,
      email: email || undefined,
      phone: phone || undefined,
      address: hasAddress
        ? {
            cep: cepDigits || undefined,
            logradouro: logradouro || undefined,
            numero: numero || undefined,
            complemento: complemento || undefined,
            bairro: bairro || undefined,
            cidade: cidade || undefined,
            uf: uf ? uf.toUpperCase() : undefined,
          }
        : undefined,
      notes: notes || undefined,
      autoFillCnpj: false, // já fizemos auto-fill via API; não rebusca
    })

    if (!result.ok) {
      setSubmitting(false)
      setSubmitError(result.error.message)
      return
    }

    router.push(`/app/pessoas?q=${encodeURIComponent(result.data.name)}`)
    router.refresh()
  }

  const nameLabel =
    detectedKind === 'pj'
      ? 'Razão Social'
      : detectedKind === 'pf'
        ? 'Nome completo'
        : 'Nome / Razão Social'
  const displayNameLabel = detectedKind === 'pj' ? 'Nome fantasia' : 'Apelido'

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* ─── Identidade ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <fieldset className="space-y-2">
          <label htmlFor="document" className="block text-sm font-medium">
            CPF ou CNPJ
          </label>
          <input
            id="document"
            name="document"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={document}
            onChange={(e) => setDocument(e.target.value)}
            onBlur={handleDocumentBlur}
            placeholder="Ex: 11.222.333/0001-81"
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
          <p className="text-xs text-[color:var(--ev-text-muted)]">
            {detectedKind === 'pf' && '11 dígitos detectados — Pessoa Física'}
            {detectedKind === 'pj' && '14 dígitos detectados — Pessoa Jurídica'}
            {cnpjStatus === 'fetching' && ' · consultando Receita…'}
            {cnpjStatus === 'ok' && autoFilled && (
              <>
                {' '}
                · dados preenchidos (
                {autoFilled.situacao === 'ativa' ? (
                  'ativa'
                ) : (
                  <span className="font-semibold text-[color:var(--ev-danger)]">
                    situação: {autoFilled.situacao}
                  </span>
                )}
                )
              </>
            )}
            {cnpjStatus === 'error' && cnpjMessage && (
              <span className="text-[color:var(--ev-danger)]"> · {cnpjMessage}</span>
            )}
          </p>
        </fieldset>

        {autoFilled && autoFilled.situacao !== 'ativa' && (
          <div
            role="alert"
            className="rounded-md border border-[color:var(--ev-warning)] bg-[color:var(--ev-warning-bg)] p-3 text-sm"
          >
            ⚠️ Empresa está com situação <strong>{autoFilled.situacao}</strong> na Receita Federal.
            Cadastrar mesmo assim?
          </div>
        )}

        <fieldset className="space-y-2">
          <label htmlFor="name" className="block text-sm font-medium">
            {nameLabel} <span className="text-[color:var(--ev-danger)]">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </fieldset>

        <fieldset className="space-y-2">
          <label htmlFor="displayName" className="block text-sm font-medium">
            {displayNameLabel}
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="off"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </fieldset>

        {detectedKind === 'pf' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <fieldset className="space-y-2">
              <label htmlFor="birthDate" className="block text-sm font-medium">
                Data de nascimento
              </label>
              <input
                id="birthDate"
                name="birthDate"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
                style={{ minHeight: 'var(--ev-input-min, 48px)' }}
              />
            </fieldset>

            <fieldset className="space-y-2">
              <label htmlFor="sex" className="block text-sm font-medium">
                Sexo / gênero
              </label>
              <input
                id="sex"
                name="sex"
                type="text"
                autoComplete="off"
                value={sex}
                onChange={(e) => setSex(e.target.value)}
                placeholder="Como você se identifica"
                className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
                style={{ minHeight: 'var(--ev-input-min, 48px)' }}
              />
              <p className="text-xs text-[color:var(--ev-text-muted)]">
                Texto livre — usado por anamnese e cálculos clínicos. Não inferimos (LGPD art. 11).
              </p>
            </fieldset>
          </div>
        )}
      </section>

      {/* ─── Contato ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Contato
        </h2>

        <fieldset className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </fieldset>

        <fieldset className="space-y-2">
          <label htmlFor="phone" className="block text-sm font-medium">
            Telefone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </fieldset>
      </section>

      {/* ─── Endereço ────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Endereço
        </h2>

        <fieldset className="space-y-2">
          <label htmlFor="cep" className="block text-sm font-medium">
            CEP
          </label>
          <input
            id="cep"
            name="cep"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            value={cep}
            onChange={(e) => setCep(e.target.value)}
            onBlur={handleCepBlur}
            placeholder="Ex: 01310-100"
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base sm:max-w-[200px]"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
          <p className="text-xs text-[color:var(--ev-text-muted)]">
            {cepStatus === 'fetching' && 'consultando ViaCEP…'}
            {cepStatus === 'ok' && 'endereço preenchido — revise e complete o número'}
            {cepStatus === 'error' && cepMessage && (
              <span className="text-[color:var(--ev-danger)]">{cepMessage}</span>
            )}
          </p>
        </fieldset>

        <fieldset className="space-y-2">
          <label htmlFor="logradouro" className="block text-sm font-medium">
            Logradouro
          </label>
          <input
            id="logradouro"
            name="logradouro"
            type="text"
            autoComplete="address-line1"
            value={logradouro}
            onChange={(e) => setLogradouro(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <fieldset className="space-y-2">
            <label htmlFor="numero" className="block text-sm font-medium">
              Número
            </label>
            <input
              id="numero"
              name="numero"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
              style={{ minHeight: 'var(--ev-input-min, 48px)' }}
            />
          </fieldset>

          <fieldset className="space-y-2">
            <label htmlFor="complemento" className="block text-sm font-medium">
              Complemento
            </label>
            <input
              id="complemento"
              name="complemento"
              type="text"
              autoComplete="address-line2"
              value={complemento}
              onChange={(e) => setComplemento(e.target.value)}
              className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
              style={{ minHeight: 'var(--ev-input-min, 48px)' }}
            />
          </fieldset>
        </div>

        <fieldset className="space-y-2">
          <label htmlFor="bairro" className="block text-sm font-medium">
            Bairro
          </label>
          <input
            id="bairro"
            name="bairro"
            type="text"
            autoComplete="address-level3"
            value={bairro}
            onChange={(e) => setBairro(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]">
          <fieldset className="space-y-2">
            <label htmlFor="cidade" className="block text-sm font-medium">
              Cidade
            </label>
            <input
              id="cidade"
              name="cidade"
              type="text"
              autoComplete="address-level2"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
              style={{ minHeight: 'var(--ev-input-min, 48px)' }}
            />
          </fieldset>

          <fieldset className="space-y-2">
            <label htmlFor="uf" className="block text-sm font-medium">
              UF
            </label>
            <input
              id="uf"
              name="uf"
              type="text"
              autoComplete="address-level1"
              maxLength={2}
              value={uf}
              onChange={(e) => setUf(e.target.value.toUpperCase())}
              placeholder="SP"
              className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base uppercase"
              style={{ minHeight: 'var(--ev-input-min, 48px)' }}
            />
          </fieldset>
        </div>
      </section>

      {/* ─── Observações ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <fieldset className="space-y-2">
          <label htmlFor="notes" className="block text-sm font-medium">
            Observações
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anotações livres (até 2000 caracteres)"
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
          />
        </fieldset>
      </section>

      {submitError && (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--ev-danger)] bg-[color:var(--ev-surface)] p-3 text-sm text-[color:var(--ev-danger)]"
        >
          {submitError}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting || !name}
          className="flex-1 rounded-md bg-[color:var(--ev-primary)] px-4 py-3 text-base font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          {submitting ? 'Salvando…' : 'Cadastrar'}
        </button>
        <a
          href="/app/pessoas"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-3 text-base font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Cancelar
        </a>
      </div>
    </form>
  )
}

function messageForCnpjError(code: string): string {
  switch (code) {
    case 'CNPJ_NOT_FOUND':
      return 'CNPJ não encontrado na Receita Federal'
    case 'CNPJ_INVALID':
      return 'CNPJ inválido'
    case 'CNPJ_RATE_LIMITED':
      return 'Limite de consultas atingido — aguarde'
    case 'UNAUTHORIZED':
      return 'Sessão expirada — refaça login'
    default:
      return 'Erro ao consultar CNPJ'
  }
}

function messageForCepError(code: string): string {
  switch (code) {
    case 'CEP_NOT_FOUND':
      return 'CEP não encontrado'
    case 'CEP_INVALID':
      return 'CEP deve ter 8 dígitos'
    case 'CEP_PROVIDER_DOWN':
    case 'CEP_PROVIDER_ERROR':
      return 'ViaCEP indisponível — preencha manualmente'
    case 'UNAUTHORIZED':
      return 'Sessão expirada — refaça login'
    default:
      return 'Erro ao consultar CEP'
  }
}
