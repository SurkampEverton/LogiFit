/**
 * /meu/dispositivos/historico — leituras ingeridas. Sprint 32 Faixa C.
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { requireMemberSession, withMemberContext } from '../../../lib/member-session'

export const dynamic = 'force-dynamic'

interface ReadingRow {
  id: string
  observation_code: string
  value: string
  unit: string
  measured_at: Date
  source_provider: string
  quality: string | null
}

const OBSERVATION_LABEL: Record<string, string> = {
  HR: 'Frequência cardíaca',
  HR_RESTING: 'FC repouso',
  HR_MAX: 'FC máxima',
  VO2_MAX: 'VO2 máx',
  HRV: 'VFC',
  WEIGHT: 'Peso',
  BODY_FAT_PCT: '% Gordura',
  MUSCLE_MASS_KG: 'Massa muscular',
  SLEEP_DURATION_MIN: 'Duração do sono',
  SLEEP_EFFICIENCY: 'Eficiência do sono',
  STEPS: 'Passos',
  DISTANCE_KM: 'Distância',
  CALORIES_KCAL: 'Calorias',
  READINESS_SCORE: 'Prontidão',
  RECOVERY_SCORE: 'Recuperação',
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function HistoricoPage() {
  const session = await requireMemberSession('/meu/dispositivos/historico')

  const rows = await withMemberContext(session, async () => {
    const r = await pool.query<ReadingRow>(
      `SELECT id, observation_code, value::text AS value, unit, measured_at,
              source_provider::text AS source_provider, quality
       FROM device_readings
       WHERE member_id = $1
         AND measured_at >= NOW() - INTERVAL '90 days'
       ORDER BY measured_at DESC
       LIMIT 200`,
      [session.memberId],
    )
    return r.rows
  })

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Histórico de leituras</h1>
        <p className="ev-portal-muted">Últimas leituras dos seus dispositivos (90 dias).</p>
      </header>

      {rows.length === 0 ? (
        <div className="ev-portal-empty">
          Nenhuma leitura ainda. Conecte um dispositivo ou importe um arquivo CSV.
          <br />
          <Link href="/meu/dispositivos">Conectar dispositivo</Link>
        </div>
      ) : (
        <ol className="ev-portal-timeline">
          {rows.map((r) => (
            <li key={r.id} className="ev-portal-timeline-item">
              <div className="ev-portal-h3">
                {OBSERVATION_LABEL[r.observation_code] ?? r.observation_code}:{' '}
                <strong style={{ fontFamily: 'monospace' }}>
                  {Number(r.value).toFixed(1)} {r.unit}
                </strong>
              </div>
              <div className="ev-portal-muted">
                {formatDateTime(r.measured_at)} · {r.source_provider}
                {r.quality ? ` · qualidade: ${r.quality}` : ''}
              </div>
            </li>
          ))}
        </ol>
      )}

      <Link href="/meu/dispositivos" className="ev-portal-button ev-portal-button--ghost">
        ← Voltar
      </Link>
    </div>
  )
}
