'use client'

/**
 * Cadastro do certificado digital A1 (Sprint 41a.2, ADR 0108).
 *
 * O arquivo é lido no client e enviado em base64 — não vai para o MinIO, vai
 * cifrado direto na coluna do banco. A senha some da memória do formulário
 * assim que cumpre seu papel, mesmo padrão do formulário de credenciais
 * municipais.
 *
 * A tela mostra o CNPJ da empresa em destaque **antes** do upload: o erro mais
 * comum em rede com filial é subir o certificado da matriz na filial, e ver o
 * CNPJ esperado na hora de escolher o arquivo evita a viagem.
 */
import { toast } from '@repo/ui'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { revokeCompanyCertificate, uploadCompanyCertificate } from './actions'

export interface CertificateCompanyOption {
  id: string
  name: string
  cnpjLabel: string | null
}

export interface CertificateRow {
  id: string
  subjectCn: string
  cnpj: string | null
  issuer: string | null
  expiresAtLabel: string
  status: string
  daysUntilExpiry: number
}

/** Tamanho máximo aceito no client — o servidor revalida (nunca confiar aqui). */
const MAX_PFX_BYTES = 64 * 1024

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  expired: 'Vencido',
  revoked: 'Revogado',
  replaced: 'Substituído',
}

export function CertificateForm({
  companies,
  certificates,
}: {
  companies: CertificateCompanyOption[]
  certificates: CertificateRow[]
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = companies.find((c) => c.id === companyId)
  const ativo = certificates.find((c) => c.status === 'active')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('Selecione o arquivo .pfx do certificado.')
      return
    }
    if (file.size > MAX_PFX_BYTES) {
      setError('Arquivo grande demais para um certificado A1. Confira se selecionou o .pfx certo.')
      return
    }

    setPending(true)
    try {
      const buffer = await file.arrayBuffer()
      const pfxBase64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))

      const r = await uploadCompanyCertificate({ companyId, pfxBase64, password })
      if (!r.ok) {
        // A mensagem do servidor é acionável por construção (diz qual CNPJ veio,
        // qual era esperado, ou que a senha está errada). Repassar íntegra.
        throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      }

      // A senha some da memória assim que cumpre seu papel.
      setPassword('')
      if (fileRef.current) fileRef.current.value = ''
      // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
      toast.success(`Certificado de ${r.data.subjectCn} cadastrado.`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cadastrar o certificado.')
    } finally {
      setPending(false)
    }
  }

  async function handleRevoke(certificateId: string) {
    setPending(true)
    try {
      const r = await revokeCompanyCertificate({ certificateId })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
      toast.success('Certificado revogado. A empresa não emite até cadastrar outro.')
      router.refresh()
    } catch (e) {
      // toast-exempt: i18n migration cross-app pendente (sprint dedicado pós-MVP)
      toast.error(e instanceof Error ? e.message : 'Erro ao revogar.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {ativo && ativo.daysUntilExpiry <= 30 && (
        <output className="ev-banner ev-banner--warning">
          {ativo.daysUntilExpiry < 0
            ? `O certificado venceu há ${Math.abs(ativo.daysUntilExpiry)} dia(s). A empresa não consegue emitir até renovar.`
            : `O certificado vence em ${ativo.daysUntilExpiry} dia(s). Renove na sua Autoridade Certificadora e faça o upload do novo.`}
        </output>
      )}

      <form onSubmit={handleSubmit} className="ev-card flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="cert-company" className="text-sm font-medium">
            Empresa
          </label>
          <select
            id="cert-company"
            className="ev-input"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            required
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {/* O engano mais comum em rede com filial é subir o certificado da
              matriz. Ver o CNPJ esperado antes de escolher o arquivo evita. */}
          {selected?.cnpjLabel && (
            <p className="text-xs text-[var(--ev-text-muted)]">
              O certificado precisa ser do CNPJ {selected.cnpjLabel}.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="cert-file" className="text-sm font-medium">
            Arquivo do certificado (.pfx ou .p12)
          </label>
          <input
            id="cert-file"
            ref={fileRef}
            type="file"
            accept=".pfx,.p12"
            className="ev-input"
            required
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="cert-password" className="text-sm font-medium">
            Senha do certificado
          </label>
          <input
            id="cert-password"
            type="password"
            className="ev-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            required
          />
          <p className="text-xs text-[var(--ev-text-muted)]">
            É a senha definida na exportação do certificado pela Autoridade Certificadora. Fica
            cifrada no servidor e nunca é exibida de volta.
          </p>
        </div>

        {error && (
          <p className="ev-form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="ev-btn ev-btn--primary self-start" disabled={pending}>
          {pending ? 'Validando…' : 'Cadastrar certificado'}
        </button>
      </form>

      {certificates.length > 0 && (
        <div className="ev-card flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Histórico</h2>
          {/* Certificado substituído/revogado permanece na lista: é o que
              responde "com qual certificado esta nota foi assinada?". */}
          <div className="overflow-x-auto">
            <table className="ev-table w-full">
              <thead>
                <tr>
                  <th>Titular</th>
                  <th>CNPJ</th>
                  <th>Válido até</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {certificates.map((c) => (
                  <tr key={c.id}>
                    <td>{c.subjectCn || '—'}</td>
                    <td>{c.cnpj ?? '—'}</td>
                    <td>{c.expiresAtLabel}</td>
                    <td>{STATUS_LABEL[c.status] ?? c.status}</td>
                    <td>
                      {c.status === 'active' && (
                        <button
                          type="button"
                          className="ev-btn ev-btn--ghost"
                          disabled={pending}
                          onClick={() => handleRevoke(c.id)}
                        >
                          Revogar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
