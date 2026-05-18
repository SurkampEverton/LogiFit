/**
 * /meu/qr — QR Code rotativo (acesso na catraca). Sprint 26 Faixa C (26b).
 *
 * Reusa lib `qr-rotation.ts` (HMAC-SHA256, window 60s).
 * Server Component renderiza o payload inicial; client component refaz fetch
 * a cada 60s (sem deixar QR expirar visualmente).
 *
 * Secret HMAC vem de `device_secrets` (Sprint 08) compartilhado por tenant.
 * Sprint 26c: secret rotativo por device (multi-catraca tenant).
 */
import { requireMemberSession, withMemberContext } from '../../lib/member-session'
import { pool } from '@repo/db/client'
import { generateQrPayload, encodeQrString } from '@repo/db/portal-member'
import { QrLiveDisplay } from './qr-live-display'

export const dynamic = 'force-dynamic'

export default async function MeuQrPage() {
  const session = await requireMemberSession('/meu/qr')

  // Busca secret HMAC do tenant (Sprint 08 access_secrets — última ativa)
  const secret = await withMemberContext(session, async () => {
    const r = await pool.query<{ secret: string }>(
      `SELECT secret FROM access_secrets
       WHERE tenant_id = $1 AND active = true
       ORDER BY created_at DESC LIMIT 1`,
      [session.tenantId],
    )
    return r.rows[0]?.secret ?? null
  })

  if (!secret) {
    return (
      <div className="ev-portal-page">
        <h1 className="ev-portal-h1">QR de acesso</h1>
        <div className="ev-portal-empty">
          QR de acesso ainda não foi configurado neste estabelecimento. Fale com a recepção.
        </div>
      </div>
    )
  }

  // Gera payload inicial (cliente vai regenerar a cada 60s)
  const payload = generateQrPayload({
    memberId: session.memberId,
    tenantId: session.tenantId,
    secret,
  })
  const initialQrString = encodeQrString(payload)

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">QR de acesso</h1>
        <p className="ev-portal-muted">
          Apresente este QR na catraca da academia. Ele é renovado automaticamente a cada 60
          segundos.
        </p>
      </header>

      <QrLiveDisplay
        memberId={session.memberId}
        tenantId={session.tenantId}
        initialQrString={initialQrString}
      />

      <div className="ev-portal-callout">
        <h2 className="ev-portal-h3">Como usar</h2>
        <p className="ev-portal-muted">
          Aponte a tela para o leitor da catraca quando chegar. Se houver erro, aguarde o QR
          renovar (max 60s).
        </p>
      </div>
    </div>
  )
}
