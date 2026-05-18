'use client'

/**
 * Branding form — Sprint 29 Faixa C.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { upsertBranding } from '../../nutri/actions'

interface Props {
  initial: {
    primary_color: string
    logo_width_px: number
    logo_storage_path: string | null
    signature_storage_path: string | null
    professional_name_default: string | null
    footer_text: string | null
  }
}

export function BrandingForm({ initial }: Props) {
  const router = useRouter()
  const [primaryColor, setPrimaryColor] = useState(initial.primary_color)
  const [logoWidth, setLogoWidth] = useState(initial.logo_width_px)
  const [profName, setProfName] = useState(initial.professional_name_default ?? '')
  const [footer, setFooter] = useState(initial.footer_text ?? '')
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    startTransition(async () => {
      try {
        const r = (await upsertBranding({
          primaryColor,
          logoWidthPx: logoWidth,
          professionalNameDefault: profName || null,
          footerText: footer || null,
        })) as { ok: boolean; error?: { message?: string } }
        if (!r.ok) {
          setMsg({ kind: 'err', text: r.error?.message ?? 'Falha' })
          return
        }
        setMsg({ kind: 'ok', text: 'Branding atualizado.' })
        router.refresh()
      } catch (e) {
        setMsg({
          kind: 'err',
          text: e instanceof Error ? e.message : 'Erro inesperado',
        })
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="ev-card"
      style={{
        padding: 'var(--ev-space-md)',
        display: 'grid',
        gap: 'var(--ev-space-3)',
        maxWidth: 520,
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-1)' }}>
        <span style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
          Cor principal (hex)
        </span>
        <div style={{ display: 'flex', gap: 'var(--ev-space-2)', alignItems: 'center' }}>
          <input
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            style={{
              width: 60,
              height: 44,
              border: '1px solid var(--ev-border)',
              borderRadius: 'var(--ev-radius-md)',
              padding: 0,
            }}
          />
          <input
            type="text"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            pattern="^#[0-9A-Fa-f]{6}$"
            style={{
              flex: 1,
              padding: 'var(--ev-space-2) var(--ev-space-3)',
              border: '1px solid var(--ev-border)',
              borderRadius: 'var(--ev-radius-md)',
              backgroundColor: 'var(--ev-surface)',
              fontFamily: 'monospace',
              minHeight: 44,
            }}
          />
        </div>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-1)' }}>
        <span style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
          Largura da logo no PDF (px)
        </span>
        <input
          type="number"
          min={40}
          max={400}
          value={logoWidth}
          onChange={(e) => setLogoWidth(Number(e.target.value))}
          style={{
            padding: 'var(--ev-space-2) var(--ev-space-3)',
            border: '1px solid var(--ev-border)',
            borderRadius: 'var(--ev-radius-md)',
            backgroundColor: 'var(--ev-surface)',
            minHeight: 44,
            maxWidth: 120,
          }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-1)' }}>
        <span style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
          Nome do profissional (default no PDF)
        </span>
        <input
          type="text"
          value={profName}
          onChange={(e) => setProfName(e.target.value)}
          placeholder="Ex: Dra. Maria Silva — CRN 12345"
          style={{
            padding: 'var(--ev-space-2) var(--ev-space-3)',
            border: '1px solid var(--ev-border)',
            borderRadius: 'var(--ev-radius-md)',
            backgroundColor: 'var(--ev-surface)',
            minHeight: 44,
          }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-1)' }}>
        <span style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
          Rodapé (CNPJ, endereço, telefone)
        </span>
        <textarea
          value={footer}
          onChange={(e) => setFooter(e.target.value)}
          rows={3}
          placeholder="Ex: Clínica X — CNPJ 00.000.000/0001-00 · Rua Y, 100 · (11) 99999-9999"
          style={{
            padding: 'var(--ev-space-2) var(--ev-space-3)',
            border: '1px solid var(--ev-border)',
            borderRadius: 'var(--ev-radius-md)',
            backgroundColor: 'var(--ev-surface)',
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ev-space-md)' }}>
        <button type="submit" disabled={pending} className="ev-btn ev-btn-primary">
          {pending ? 'Salvando...' : 'Salvar'}
        </button>
        <div
          style={{
            width: 40,
            height: 24,
            backgroundColor: primaryColor,
            borderRadius: 'var(--ev-radius-sm)',
            border: '1px solid var(--ev-border)',
          }}
          aria-label="Pré-visualização da cor"
        />
        {msg ? (
          <span
            style={{
              color: msg.kind === 'ok' ? 'var(--ev-success-hover)' : 'var(--ev-danger-hover)',
              fontSize: 'var(--ev-text-sm)',
            }}
          >
            {msg.text}
          </span>
        ) : null}
      </div>

      <p style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
        Upload de logo + assinatura digitalizada entra em Sprint 29b (depende MinIO storage adapter).
      </p>
    </form>
  )
}
