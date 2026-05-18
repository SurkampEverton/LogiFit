/**
 * /meu/diario — diário alimentar do paciente. Sprint 31 Faixa C.
 *
 * Lista entries dos últimos 14 dias agrupadas por data. Mostra resumo
 * nutricional por refeição + status de review do nutri (se houver).
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { requireMemberSession, withMemberContext } from '../../lib/member-session'

export const dynamic = 'force-dynamic'

interface DiaryRow {
  id: string
  consumed_date: Date
  meal_name: string
  consumed_at: Date | null
  free_text_description: string | null
  photo_storage_path: string | null
  calculated_nutrition: Record<string, number> | null
  review_status: string | null
  reviewed_at: Date | null
}

const MEAL_LABEL: Record<string, string> = {
  cafe: 'Café da manhã',
  lanche_manha: 'Lanche da manhã',
  almoco: 'Almoço',
  lanche_tarde: 'Lanche da tarde',
  jantar: 'Jantar',
  ceia: 'Ceia',
  pre_treino: 'Pré-treino',
  pos_treino: 'Pós-treino',
  outro: 'Outro',
}

const REVIEW_LABEL: Record<string, string> = {
  approved: '✓ Aprovado pelo nutri',
  needs_adjustment: '⚠ Precisa ajuste',
  flagged: '⚠ Sinalizado',
}

const REVIEW_BADGE: Record<string, string> = {
  approved: 'ev-portal-badge--success',
  needs_adjustment: 'ev-portal-badge--warning',
  flagged: 'ev-portal-badge--danger',
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

function formatTime(d: Date | null): string {
  if (!d) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default async function MeuDiarioPage() {
  const session = await requireMemberSession('/meu/diario')

  const entries = await withMemberContext(session, async () => {
    const r = await pool.query<DiaryRow>(
      `SELECT id, consumed_date, meal_name, consumed_at, free_text_description,
              photo_storage_path, calculated_nutrition, review_status, reviewed_at
       FROM meal_log_entries
       WHERE member_id = $1 AND consumed_date >= CURRENT_DATE - INTERVAL '14 days'
       ORDER BY consumed_date DESC, consumed_at DESC NULLS LAST
       LIMIT 100`,
      [session.memberId],
    )
    return r.rows
  })

  // Agrupa por data
  const byDate = new Map<string, DiaryRow[]>()
  for (const e of entries) {
    const key = e.consumed_date.toISOString().slice(0, 10)
    const arr = byDate.get(key) ?? []
    arr.push(e)
    byDate.set(key, arr)
  }

  return (
    <div className="ev-portal-page">
      <header className="ev-portal-section">
        <h1 className="ev-portal-h1">Diário alimentar</h1>
        <Link href="/meu/diario/novo" className="ev-portal-button">
          + Registrar refeição
        </Link>
      </header>

      {entries.length === 0 ? (
        <div className="ev-portal-empty">
          Nenhuma refeição registrada ainda.
          <br />
          Comece pela próxima refeição — leva 30 segundos.
        </div>
      ) : (
        Array.from(byDate.entries()).map(([dateKey, dayEntries]) => {
          const totalKcal = dayEntries.reduce(
            (sum, e) => sum + ((e.calculated_nutrition?.kcal as number | undefined) ?? 0),
            0,
          )
          return (
            <section key={dateKey} className="ev-portal-section">
              <header
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <h2 className="ev-portal-h2">{formatDate(dayEntries[0]!.consumed_date)}</h2>
                <span className="ev-portal-muted">
                  {totalKcal > 0 ? `${totalKcal.toFixed(0)} kcal · ` : ''}
                  {dayEntries.length} refeições
                </span>
              </header>
              <ul className="ev-portal-list">
                {dayEntries.map((e) => (
                  <li key={e.id} className="ev-portal-list-item">
                    <div className="ev-portal-list-item--row">
                      <div>
                        <div className="ev-portal-h3">
                          {MEAL_LABEL[e.meal_name] ?? e.meal_name}
                          {e.consumed_at ? (
                            <span className="ev-portal-muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                              {formatTime(e.consumed_at)}
                            </span>
                          ) : null}
                        </div>
                        {e.free_text_description ? (
                          <p style={{ margin: '4px 0 0 0' }}>{e.free_text_description}</p>
                        ) : null}
                        {e.calculated_nutrition ? (
                          <div className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-xs)' }}>
                            {(e.calculated_nutrition.kcal ?? 0).toFixed(0)} kcal ·
                            P {(e.calculated_nutrition.protein_g ?? 0).toFixed(0)}g ·
                            C {(e.calculated_nutrition.carbohydrate_g ?? 0).toFixed(0)}g ·
                            L {(e.calculated_nutrition.lipid_g ?? 0).toFixed(0)}g
                          </div>
                        ) : null}
                      </div>
                      {e.review_status ? (
                        <span
                          className={`ev-portal-badge ${REVIEW_BADGE[e.review_status] ?? ''}`}
                        >
                          {REVIEW_LABEL[e.review_status] ?? e.review_status}
                        </span>
                      ) : (
                        <span className="ev-portal-badge">Aguarda nutri</span>
                      )}
                    </div>
                    {e.photo_storage_path ? (
                      <span className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-xs)' }}>
                        📷 Foto anexada
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}
