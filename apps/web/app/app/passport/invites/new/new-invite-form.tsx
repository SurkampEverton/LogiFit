'use client'

import Link from 'next/link'
/**
 * Client form pra criar invite cross-tenant (Sprint 02b8).
 *
 * UX:
 *   1. Staff seleciona paciente, módulo clínico, profissional responsável
 *   2. Submit → `sendPatientInviteSimple` Server Action
 *   3. Resultado expande inline com 3 botões condicionais:
 *      - [✓ Email enviado pra X] (se emailSent === true)
 *      - [💬 Compartilhar no WhatsApp] (se whatsappShareUrl)
 *      - [📋 Copiar link] (sempre)
 *   4. Botão "Criar outro" reseta form
 */
import { useState, useTransition } from 'react'
import { sendPatientInviteSimple } from '../../actions'

interface PatientOption {
  personId: string
  name: string
  email: string | null
  phone: string | null
  document: string | null
}

interface ProfessionalOption {
  userId: string
  name: string
  role: string
}

const MODULE_OPTIONS = [
  { value: 'academia', label: '🏋️ Academia' },
  { value: 'personal_training', label: '🤸 Personal Training' },
  { value: 'fisioterapia', label: '🩺 Fisioterapia' },
  { value: 'nutricao', label: '🥗 Nutrição' },
  { value: 'pilates', label: '🧘 Pilates' },
] as const

interface InviteResult {
  linkId: string
  inviteUrl: string
  emailSent: boolean | null
  whatsappShareUrl: string | null
  patientEmail: string | null
}

export function NewInviteForm({
  patients,
  professionals,
}: {
  patients: PatientOption[]
  professionals: ProfessionalOption[]
}) {
  const [personId, setPersonId] = useState('')
  const [moduleKind, setModuleKind] = useState<string>('')
  const [responsibleId, setResponsibleId] = useState('')
  const [result, setResult] = useState<InviteResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copyConfirm, setCopyConfirm] = useState(false)
  const [pending, startTransition] = useTransition()

  const selectedPatient = patients.find((p) => p.personId === personId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setResult(null)
    setCopyConfirm(false)

    startTransition(async () => {
      try {
        const r = (await sendPatientInviteSimple({
          personId,
          moduleKind: moduleKind as
            | 'academia'
            | 'personal_training'
            | 'fisioterapia'
            | 'nutricao'
            | 'pilates',
          responsibleProfessionalUserId: responsibleId,
        })) as
          | {
              ok: true
              linkId: string
              inviteUrl: string
              emailSent: boolean | null
              whatsappShareUrl: string | null
            }
          | { ok: false; error?: { message?: string } }

        if ('ok' in r && !r.ok) {
          setErr(r.error?.message ?? 'Falha ao criar convite')
          return
        }

        setResult({
          linkId: r.linkId,
          inviteUrl: r.inviteUrl,
          emailSent: r.emailSent,
          whatsappShareUrl: r.whatsappShareUrl,
          patientEmail: selectedPatient?.email ?? null,
        })
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  function handleCopyLink() {
    if (!result) return
    navigator.clipboard.writeText(result.inviteUrl).then(
      () => {
        setCopyConfirm(true)
        setTimeout(() => setCopyConfirm(false), 2000)
      },
      () => {
        setErr('Falha ao copiar — copie manualmente')
      },
    )
  }

  function handleReset() {
    setPersonId('')
    setModuleKind('')
    setResponsibleId('')
    setResult(null)
    setErr(null)
    setCopyConfirm(false)
  }

  // ─── RESULT VIEW ─────────────────────────────────────────────────
  if (result) {
    return (
      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <h2 className="text-xl font-semibold" style={{ marginBottom: 'var(--ev-space-2)' }}>
            ✓ Convite criado
          </h2>
          <p style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-sm)' }}>
            Paciente: <strong>{selectedPatient?.name}</strong> · Link:{' '}
            <code>{result.linkId.slice(0, 8)}…</code>
          </p>
        </div>

        {/* 1. EMAIL */}
        {result.emailSent === true && (
          <div
            style={{
              background: 'var(--ev-success-soft, var(--ev-surface-muted))',
              borderLeft: '4px solid var(--ev-success)',
              padding: 'var(--ev-space-2) var(--ev-space-md)',
              borderRadius: 'var(--ev-radius-sm)',
            }}
          >
            <p style={{ margin: 0, fontSize: 'var(--ev-text-sm)' }}>
              ✓ Email enviado automaticamente pra <strong>{result.patientEmail}</strong>
            </p>
          </div>
        )}
        {result.emailSent === false && (
          <div
            style={{
              background: 'var(--ev-warning-soft, var(--ev-surface-muted))',
              borderLeft: '4px solid var(--ev-warning)',
              padding: 'var(--ev-space-2) var(--ev-space-md)',
              borderRadius: 'var(--ev-radius-sm)',
            }}
          >
            <p style={{ margin: 0, fontSize: 'var(--ev-text-sm)' }}>
              ⚠ Email falhou ao enviar — use os outros canais abaixo
            </p>
          </div>
        )}
        {result.emailSent === null && (
          <div
            style={{
              background: 'var(--ev-info-soft, var(--ev-surface-muted))',
              borderLeft: '4px solid var(--ev-info)',
              padding: 'var(--ev-space-2) var(--ev-space-md)',
              borderRadius: 'var(--ev-radius-sm)',
            }}
          >
            <p style={{ margin: 0, fontSize: 'var(--ev-text-sm)' }}>
              ℹ️ Paciente sem email cadastrado — use WhatsApp ou copy link abaixo
            </p>
          </div>
        )}

        {/* 2. WHATSAPP STAFF SHARE */}
        {result.whatsappShareUrl && (
          <div>
            <a
              href={result.whatsappShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ev-btn"
              style={{
                // design-token-exempt: verde WhatsApp brand é exigência identidade visual
                background: '#25D366',
                color: 'white',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--ev-space-2)',
                padding: 'var(--ev-space-2) var(--ev-space-md)',
                borderRadius: 'var(--ev-radius-sm)',
                textDecoration: 'none',
                fontSize: 'var(--ev-text-sm)',
              }}
            >
              💬 Compartilhar no WhatsApp do paciente
            </a>
            <p
              style={{
                color: 'var(--ev-text-muted)',
                fontSize: 'var(--ev-text-xs)',
                marginTop: 'var(--ev-space-1)',
              }}
            >
              Abre WhatsApp Web com chat direcionado ao paciente + mensagem pronta
            </p>
          </div>
        )}

        {/* 3. COPY LINK (sempre disponível) */}
        <div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--ev-space-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <input
              type="text"
              readOnly
              value={result.inviteUrl}
              className="ev-input"
              style={{ flex: 1, minWidth: 280, fontSize: 'var(--ev-text-sm)' }}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button type="button" onClick={handleCopyLink} className="ev-btn ev-btn--secondary">
              {copyConfirm ? '✓ Copiado' : '📋 Copiar'}
            </button>
          </div>
          <p
            style={{
              color: 'var(--ev-text-muted)',
              fontSize: 'var(--ev-text-xs)',
              marginTop: 'var(--ev-space-1)',
            }}
          >
            Cole no canal de sua preferência (SMS, Telegram, papel impresso, etc)
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--ev-space-2)', marginTop: 'var(--ev-space-md)' }}>
          <button type="button" onClick={handleReset} className="ev-btn ev-btn--primary">
            Criar outro convite
          </button>
          <Link href="/app/passport" className="ev-btn">
            Voltar
          </Link>
        </div>
      </section>
    )
  }

  // ─── FORM VIEW ───────────────────────────────────────────────────
  return (
    <form
      onSubmit={handleSubmit}
      className="ev-card"
      style={{
        padding: 'var(--ev-space-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ev-space-md)',
      }}
    >
      <div>
        <label htmlFor="patient" style={{ display: 'block', marginBottom: 'var(--ev-space-1)' }}>
          Paciente *
        </label>
        <select
          id="patient"
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
          required
          className="ev-input"
          style={{ width: '100%' }}
        >
          <option value="">— Selecione —</option>
          {patients.map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.name}
              {p.email ? ` · ${p.email}` : ' · sem email'}
              {p.phone ? ` · ${p.phone}` : ''}
            </option>
          ))}
        </select>
        {patients.length === 0 && (
          <p
            style={{
              color: 'var(--ev-text-muted)',
              fontSize: 'var(--ev-text-xs)',
              marginTop: 'var(--ev-space-1)',
            }}
          >
            Nenhum paciente cadastrado. Crie um em{' '}
            <Link href="/app/members/new">/app/members/new</Link> primeiro.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="module" style={{ display: 'block', marginBottom: 'var(--ev-space-1)' }}>
          Módulo clínico *
        </label>
        <select
          id="module"
          value={moduleKind}
          onChange={(e) => setModuleKind(e.target.value)}
          required
          className="ev-input"
          style={{ width: '100%' }}
        >
          <option value="">— Selecione —</option>
          {MODULE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="prof" style={{ display: 'block', marginBottom: 'var(--ev-space-1)' }}>
          Profissional responsável *
        </label>
        <select
          id="prof"
          value={responsibleId}
          onChange={(e) => setResponsibleId(e.target.value)}
          required
          className="ev-input"
          style={{ width: '100%' }}
        >
          <option value="">— Selecione —</option>
          {professionals.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name} ({p.role})
            </option>
          ))}
        </select>
        {professionals.length === 0 && (
          <p
            style={{
              color: 'var(--ev-text-muted)',
              fontSize: 'var(--ev-text-xs)',
              marginTop: 'var(--ev-space-1)',
            }}
          >
            Nenhum profissional registrado. Adicione roles em /app/settings/roles primeiro.
          </p>
        )}
      </div>

      {err && <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>}

      <div style={{ display: 'flex', gap: 'var(--ev-space-2)' }}>
        <button
          type="submit"
          disabled={pending || !personId || !moduleKind || !responsibleId}
          className="ev-btn ev-btn--primary"
        >
          {pending ? 'Criando...' : 'Criar convite'}
        </button>
        <Link href="/app/passport" className="ev-btn">
          Cancelar
        </Link>
      </div>
    </form>
  )
}
