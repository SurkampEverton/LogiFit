'use client'

/**
 * Form de NFS-e avulsa — Sprint 36b.4 (ADR 0059).
 *
 * Valor digitado em R$ e convertido pra centavos na borda. Sucesso redireciona
 * pro detalhe da emissão (`/app/fiscal/[id]`).
 */
import { confirm } from '@repo/ui'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { emitNfseManual } from '../../actions'

interface ServiceOption {
  id: string
  companyId: string
  description: string
  issRateBp: number
  lc116Code: string | null
}

export function NfseManualForm({
  companies,
  services,
  isProducao = false,
}: {
  companies: Array<{ id: string; name: string }>
  services: ServiceOption[]
  /** Credencial fiscal do tenant em produção — emissão tem efeito legal real */
  isProducao?: boolean
}) {
  const router = useRouter()
  const firstCompanyWithService =
    companies.find((c) => services.some((s) => s.companyId === c.id))?.id ?? ''
  const [companyId, setCompanyId] = useState(firstCompanyWithService)
  const companyServices = useMemo(
    () => services.filter((s) => s.companyId === companyId),
    [services, companyId],
  )
  const [serviceId, setServiceId] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientDocument, setRecipientDocument] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [valor, setValor] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveServiceId = serviceId || companyServices[0]?.id || ''

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const valorTotalCents = Math.round(Number.parseFloat(valor.replace(',', '.')) * 100)
    if (!Number.isFinite(valorTotalCents) || valorTotalCents <= 0) {
      setError('Valor inválido')
      return
    }

    // Em produção a emissão é irreversível na prática: cancelar depende da
    // janela do município e, em vários deles, só funciona no portal da
    // prefeitura. Confirma com os dados à vista antes de transmitir.
    if (isProducao) {
      const brl = (valorTotalCents / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      })
      const ok = await confirm({
        title: 'Emitir documento fiscal real?',
        body: (
          <>
            <p style={{ margin: '0 0 var(--ev-space-sm)' }}>
              Esta NFS-e vale para o fisco e gera ISS devido. Ela <strong>não</strong> é um teste.
            </p>
            <p style={{ margin: 0 }}>
              <strong>{recipientName.trim() || 'Tomador não informado'}</strong>
              {recipientDocument.trim() ? ` · ${recipientDocument.trim()}` : ''}
              <br />
              Valor: <strong>{brl}</strong>
            </p>
            <p style={{ margin: 'var(--ev-space-sm) 0 0', color: 'var(--ev-text-muted)' }}>
              O cancelamento depende da janela do município e, em alguns, só pode ser feito no
              portal da prefeitura.
            </p>
          </>
        ),
        danger: true,
        confirmLabel: 'Emitir nota real',
      })
      if (!ok) return
    }

    setPending(true)
    try {
      const r = await emitNfseManual({
        companyId,
        serviceCatalogId: effectiveServiceId,
        recipient: {
          document: recipientDocument,
          name: recipientName.trim(),
          email: recipientEmail.trim() || undefined,
        },
        valorTotalCents,
        notes: notes.trim() || undefined,
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      router.push(`/app/fiscal/${r.data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao emitir NFS-e')
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="ev-card grid gap-3"
      style={{
        padding: 'var(--ev-space-md)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
        maxWidth: '52rem',
      }}
    >
      <div className="space-y-1">
        <label htmlFor="nfse-company" className="text-sm font-medium">
          Empresa emitente
        </label>
        <select
          id="nfse-company"
          className="ev-input w-full"
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value)
            setServiceId('')
          }}
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
        <label htmlFor="nfse-service" className="text-sm font-medium">
          Serviço (catálogo)
        </label>
        <select
          id="nfse-service"
          className="ev-input w-full"
          value={effectiveServiceId}
          onChange={(e) => setServiceId(e.target.value)}
          required
          disabled={companyServices.length === 0}
        >
          {companyServices.length === 0 && <option value="">Sem serviço pra esta empresa</option>}
          {companyServices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.description}
              {s.lc116Code ? ` · LC ${s.lc116Code}` : ''} · ISS {(s.issRateBp / 100).toFixed(2)}%
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="nfse-recipient-name" className="text-sm font-medium">
          Tomador — nome
        </label>
        <input
          id="nfse-recipient-name"
          className="ev-input w-full"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          required
          minLength={2}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="nfse-recipient-doc" className="text-sm font-medium">
          Tomador — CPF/CNPJ
        </label>
        <input
          id="nfse-recipient-doc"
          className="ev-input w-full"
          placeholder="000.000.000-00"
          value={recipientDocument}
          onChange={(e) => setRecipientDocument(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="nfse-recipient-email" className="text-sm font-medium">
          Tomador — email (opcional)
        </label>
        <input
          id="nfse-recipient-email"
          type="email"
          className="ev-input w-full"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="nfse-valor" className="text-sm font-medium">
          Valor do serviço (R$)
        </label>
        <input
          id="nfse-valor"
          className="ev-input w-full"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="199,00"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1" style={{ gridColumn: '1 / -1' }}>
        <label htmlFor="nfse-notes" className="text-sm font-medium">
          Observações (opcional — saem na nota)
        </label>
        <textarea
          id="nfse-notes"
          className="ev-input w-full"
          rows={2}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3" style={{ gridColumn: '1 / -1' }}>
        <button
          type="submit"
          className={isProducao ? 'ev-btn ev-btn-danger' : 'ev-btn ev-btn-primary'}
          disabled={pending || !effectiveServiceId}
        >
          {pending ? 'Emitindo…' : isProducao ? '📄 Emitir NFS-e real' : '📄 Emitir NFS-e'}
        </button>
        {error && (
          <span className="text-xs" role="alert" style={{ color: 'var(--ev-danger, #dc2626)' }}>
            {error}
          </span>
        )}
      </div>
    </form>
  )
}
