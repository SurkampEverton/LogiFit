import { db } from '@repo/db/client'
/**
 * `/app/settings/branding` — configuração de logo + cores para PDF do plano
 * alimentar (e futuros docs). Sprint 29 Faixa C.
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { BrandingForm } from './form'

export const dynamic = 'force-dynamic'

interface BrandingRow {
  tenant_id: string
  logo_storage_path: string | null
  primary_color: string
  logo_width_px: number
  signature_storage_path: string | null
  professional_name_default: string | null
  footer_text: string | null
}

export default async function BrandingPage() {
  const session = await requireFullSession('/app/settings/branding')
  const tenantId = session.logifit.tenantId

  const rows = (
    await db.execute(sql`
      SELECT tenant_id, logo_storage_path, primary_color, logo_width_px,
             signature_storage_path, professional_name_default, footer_text
      FROM tenant_branding
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `)
  ).rows as unknown as BrandingRow[]

  const current: BrandingRow = rows[0] ?? {
    tenant_id: tenantId,
    logo_storage_path: null,
    // design-token-exempt: cor inicial de branding tenant — espelha schema default (dado, não tema UI)
    primary_color: '#3498DB',
    logo_width_px: 120,
    signature_storage_path: null,
    professional_name_default: null,
    footer_text: null,
  }

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-md)',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0 }}>Branding</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          Logo + cores aplicados em PDFs (plano alimentar, recibos)
        </span>
      </header>

      <BrandingForm initial={current} />

      <Link href="/app/settings" className="ev-btn ev-btn-ghost">
        ← Voltar para configurações
      </Link>
    </div>
  )
}
