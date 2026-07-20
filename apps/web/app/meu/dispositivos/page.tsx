import { pool } from '@repo/db/client'
/**
 * /meu/dispositivos — lista de dispositivos conectados + opções de conectar.
 *   Sprint 32 Faixa C (ADR 0049).
 */
import Link from 'next/link'
import { withMemberContext } from '../../lib/member-session'
import { requireMemberOrPassport } from '../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../_components/passport-needs-link'

export const dynamic = 'force-dynamic'

interface ConnRow {
  id: string
  provider: string
  status: string
  device_label: string | null
  connected_at: Date
  last_synced_at: Date | null
  last_error: string | null
}

const PROVIDER_LABEL: Record<string, string> = {
  garmin: 'Garmin Connect',
  oura: 'Oura Ring',
  fitbit: 'Fitbit',
  apple_health: 'Apple Health',
  google_health: 'Google Health Connect',
  ble_scale_omron: 'Balança Omron (Bluetooth)',
  ble_scale_gtech: 'Balança G-Tech (Bluetooth)',
  file_import: 'Importar arquivo (CSV/InBody)',
  mock: 'Mock (teste)',
}

const PROVIDER_ICON: Record<string, string> = {
  garmin: '⌚',
  oura: '💍',
  fitbit: '⌚',
  apple_health: '🍎',
  google_health: '📱',
  ble_scale_omron: '⚖️',
  ble_scale_gtech: '⚖️',
  file_import: '📄',
  mock: '🧪',
}

const STATUS_BADGE: Record<string, string> = {
  active: 'ev-portal-badge--success',
  error: 'ev-portal-badge--danger',
  pending: 'ev-portal-badge--warning',
  revoked: 'ev-portal-badge',
}

const STATUS_LABEL: Record<string, string> = {
  active: '● Conectado',
  error: '⚠ Erro de sync',
  pending: '⏳ Aguardando autorização',
  revoked: '◯ Desconectado',
}

const AVAILABLE_PROVIDERS = [
  'garmin',
  'oura',
  'fitbit',
  'apple_health',
  'google_health',
  'ble_scale_omron',
  'ble_scale_gtech',
  'file_import',
]

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function MeuDispositivosPage() {
  const ctx = await requireMemberOrPassport('/meu/dispositivos')
  if (ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="seus dispositivos" />
  }
  const session = ctx.claims

  const connections = await withMemberContext(session, async () => {
    const r = await pool.query<ConnRow>(
      `SELECT id, provider::text AS provider, status::text AS status,
              device_label, connected_at, last_synced_at, last_error
       FROM device_connections
       WHERE member_id = $1
       ORDER BY connected_at DESC`,
      [session.memberId],
    )
    return r.rows
  })

  const connectedProviders = new Set(
    connections
      .filter((c) => c.status === 'active' || c.status === 'pending')
      .map((c) => c.provider),
  )
  const availableToConnect = AVAILABLE_PROVIDERS.filter((p) => !connectedProviders.has(p))

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Dispositivos</h1>
        <p className="ev-portal-muted">
          Conecte seu wearable ou balança para que o profissional acompanhe sua evolução. Você
          decide quais dados compartilhar.
        </p>
      </header>

      <section className="ev-portal-section">
        <h2 className="ev-portal-h2">Conectados</h2>
        {connections.length === 0 ? (
          <div className="ev-portal-empty">Nenhum dispositivo conectado ainda.</div>
        ) : (
          <ul className="ev-portal-list">
            {connections.map((c) => (
              <li key={c.id} className="ev-portal-list-item">
                <div className="ev-portal-list-item--row">
                  <div>
                    <div className="ev-portal-h3">
                      <span style={{ marginRight: 6 }}>{PROVIDER_ICON[c.provider] ?? '📡'}</span>
                      {c.device_label ?? PROVIDER_LABEL[c.provider] ?? c.provider}
                    </div>
                    <div className="ev-portal-muted">
                      Conectado em {formatDate(c.connected_at)} · Última sync{' '}
                      {formatDate(c.last_synced_at)}
                    </div>
                    {c.last_error ? (
                      <div className="ev-portal-muted" style={{ color: 'var(--ev-danger-hover)' }}>
                        ⚠ {c.last_error}
                      </div>
                    ) : null}
                  </div>
                  <span className={`ev-portal-badge ${STATUS_BADGE[c.status] ?? ''}`}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {availableToConnect.length > 0 ? (
        <section className="ev-portal-section">
          <h2 className="ev-portal-h2">Conectar novo</h2>
          <ul className="ev-portal-list">
            {availableToConnect.map((p) => (
              <li key={p} className="ev-portal-list-item">
                <div className="ev-portal-list-item--row">
                  <div>
                    <div className="ev-portal-h3">
                      <span style={{ marginRight: 6 }}>{PROVIDER_ICON[p] ?? '📡'}</span>
                      {PROVIDER_LABEL[p] ?? p}
                    </div>
                    <div className="ev-portal-muted">
                      {p === 'file_import' && 'Upload CSV InBody, FIT (Garmin), TCX/GPX'}
                      {p === 'garmin' && 'OAuth · HR, VO2, passos, sono, treinos'}
                      {p === 'oura' && 'OAuth · Recovery, VFC, sono, prontidão'}
                      {p === 'fitbit' && 'OAuth · HR, passos, sono'}
                      {p === 'apple_health' && 'Via app nativo Expo (Sprint 35)'}
                      {p === 'google_health' && 'Via app nativo Expo (Sprint 35)'}
                      {(p === 'ble_scale_omron' || p === 'ble_scale_gtech') &&
                        'Web Bluetooth via Chrome/Edge desktop'}
                    </div>
                  </div>
                  {p === 'file_import' ? (
                    <Link href="/meu/dispositivos/importar" className="ev-portal-button">
                      Importar
                    </Link>
                  ) : p === 'apple_health' || p === 'google_health' ? (
                    <span className="ev-portal-badge">Em breve</span>
                  ) : (
                    <span className="ev-portal-badge">Sprint 32b</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-xs)' }}>
        Provedores OAuth reais (Garmin, Oura, Fitbit) + Web Bluetooth ficam na próxima versão. Dados
        importados via arquivo (CSV InBody) já funcionam.
      </p>

      <Link href="/meu/dispositivos/historico" className="ev-portal-button ev-portal-button--ghost">
        Ver leituras
      </Link>
    </div>
  )
}
