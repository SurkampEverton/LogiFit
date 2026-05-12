'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createPerson } from '../actions'

/**
 * Form de criação de pessoa com auto-fill CNPJ (ADR 0048).
 *
 * UX:
 *   - Operador digita documento (CPF/CNPJ)
 *   - Quando CNPJ atinge 14 dígitos → fetch /api/pessoas/cnpj/{cnpj}
 *     preenche nome/email/phone/endereço automaticamente
 *   - Alerta se situação ≠ ativa
 *   - Submit chama Server Action createPerson
 *
 * Sprint 01a Faixa D: form simplificado. Faixa D fechamento adiciona:
 *   - PromptDialog confirmação se situação suspensa/baixada
 *   - LocaleSwitcher de placeholder
 *   - Toast.fromApiError (regra 45)
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

export function NewPersonForm() {
  const router = useRouter()
  const [document, setDocument] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [autoFilled, setAutoFilled] = useState<AutoFillState | null>(null)
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'fetching' | 'ok' | 'error'>('idle')
  const [lookupMessage, setLookupMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const docDigits = document.replace(/\D/g, '')
  const detectedKind = docDigits.length === 11 ? 'pf' : docDigits.length === 14 ? 'pj' : null

  async function handleDocumentBlur() {
    if (detectedKind !== 'pj') return
    if (lookupStatus === 'fetching') return
    setLookupStatus('fetching')
    setLookupMessage(null)
    try {
      // safe-fetch-exempt: same-origin /api/pessoas/cnpj — endpoint LogiFit interno
      const res = await fetch(`/api/pessoas/cnpj/${docDigits}`, { cache: 'no-store' })
      const json = (await res.json()) as
        | { ok: true; data: AutoFillStateWithExtra; fromCache: boolean }
        | { ok: false; error: { code: string; message?: string } }
      if (!json.ok) {
        setLookupStatus('error')
        setLookupMessage(messageForError(json.error.code))
        return
      }
      // Preenche campos vazios; não sobrescreve o que o operador já digitou
      const data = json.data
      setAutoFilled({
        name: data.razaoSocial,
        displayName: data.nomeFantasia ?? null,
        email: data.email,
        phone: data.telefone,
        address: data.address ?? null,
        situacao: data.situacao,
      })
      if (!name) setName(data.razaoSocial)
      if (!email && data.email) setEmail(data.email)
      if (!phone && data.telefone) setPhone(data.telefone)
      setLookupStatus('ok')
    } catch (_err) {
      setLookupStatus('error')
      setLookupMessage('Erro de rede ao consultar CNPJ')
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setSubmitError(null)

    const result = await createPerson({
      document: document || undefined,
      name: name || undefined,
      email: email || undefined,
      phone: phone || undefined,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
          {lookupStatus === 'fetching' && ' · consultando Receita…'}
          {lookupStatus === 'ok' && autoFilled && (
            <>
              {' '}
              · dados preenchidos ({autoFilled.situacao === 'ativa' ? 'ativa' : (
                <span className="font-semibold text-[color:var(--ev-danger)]">
                  situação: {autoFilled.situacao}
                </span>
              )})
            </>
          )}
          {lookupStatus === 'error' && lookupMessage && (
            <span className="text-[color:var(--ev-danger)]"> · {lookupMessage}</span>
          )}
        </p>
      </fieldset>

      {autoFilled && autoFilled.situacao !== 'ativa' && (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--ev-warning)] bg-[color:var(--ev-warning-bg)] p-3 text-sm"
        >
          ⚠️ Empresa está com situação <strong>{autoFilled.situacao}</strong> na Receita
          Federal. Cadastrar mesmo assim?
        </div>
      )}

      <fieldset className="space-y-2">
        <label htmlFor="name" className="block text-sm font-medium">
          Nome / Razão Social <span className="text-[color:var(--ev-danger)]">*</span>
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

interface AutoFillStateWithExtra {
  razaoSocial: string
  nomeFantasia: string | null
  email: string | null
  telefone: string | null
  address: AutoFillState['address']
  situacao: AutoFillState['situacao']
}

function messageForError(code: string): string {
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
