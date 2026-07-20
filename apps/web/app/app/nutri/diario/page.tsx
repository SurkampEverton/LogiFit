import { db } from '@repo/db/client'
/**
 * `/app/nutri/diario` — fila do nutri (entries pendentes review). Sprint 31 Faixa C.
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const MEAL_LABEL: Record<string, string> = {
  cafe: 'Café',
  lanche_manha: 'Lanche manhã',
  almoco: 'Almoço',
  lanche_tarde: 'Lanche tarde',
  jantar: 'Jantar',
  ceia: 'Ceia',
  pre_treino: 'Pré-treino',
  pos_treino: 'Pós-treino',
  outro: 'Outro',
}

export default async function NutriDiarioFilaPage() {
  const session = await requireFullSession('/app/nutri/diario')
  const tenantId = session.logifit.tenantId

  const rows = (
    await db.execute(sql`
      SELECT mle.id, mle.member_id, mle.consumed_date, mle.meal_name, mle.calculated_nutrition,
             mle.free_text_description, mle.created_at,
             p.name AS member_name
      FROM meal_log_entries mle
      INNER JOIN members m ON m.id = mle.member_id
      INNER JOIN persons p ON p.id = m.person_id
      WHERE mle.tenant_id = ${tenantId}
        AND mle.review_status IS NULL
      ORDER BY mle.created_at ASC
      LIMIT 100
    `)
  ).rows as Array<{
    id: string
    member_id: string
    consumed_date: string
    meal_name: string
    calculated_nutrition: Record<string, number> | null
    free_text_description: string | null
    created_at: string
    member_name: string
  }>

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
        <h1 style={{ margin: 0 }}>Fila de revisão · Diário alimentar</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          {rows.length} pendente{rows.length === 1 ? '' : 's'}
        </span>
      </header>

      {rows.length === 0 ? (
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <p style={{ color: 'var(--ev-text-muted)' }}>
            Tudo revisado! 🎉 Pacientes vão registrar novas refeições em <code>/meu/diario</code>.
          </p>
        </section>
      ) : (
        <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--ev-surface-muted)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Paciente</th>
                <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Data</th>
                <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Refeição</th>
                <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>O que comeu</th>
                <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>kcal</th>
                <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>Há</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const kcal = r.calculated_nutrition?.kcal ?? null
                const ageHours = Math.round(
                  (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60),
                )
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--ev-border)' }}>
                    <td style={{ padding: 'var(--ev-space-2)' }}>
                      <Link href={`/app/members/${r.member_id}`}>{r.member_name}</Link>
                    </td>
                    <td style={{ padding: 'var(--ev-space-2)', whiteSpace: 'nowrap' }}>
                      {new Date(r.consumed_date).toLocaleDateString('pt-BR')}
                    </td>
                    <td style={{ padding: 'var(--ev-space-2)' }}>
                      {MEAL_LABEL[r.meal_name] ?? r.meal_name}
                    </td>
                    <td
                      style={{
                        padding: 'var(--ev-space-2)',
                        maxWidth: 360,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.free_text_description ?? '—'}
                    </td>
                    <td
                      style={{
                        padding: 'var(--ev-space-2)',
                        textAlign: 'right',
                        fontFamily: 'monospace',
                      }}
                    >
                      {kcal != null ? kcal.toFixed(0) : '—'}
                    </td>
                    <td
                      style={{
                        padding: 'var(--ev-space-2)',
                        textAlign: 'right',
                        color: 'var(--ev-text-muted)',
                      }}
                    >
                      {ageHours < 24 ? `${ageHours}h` : `${Math.round(ageHours / 24)}d`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      <p style={{ color: 'var(--ev-text-muted)' }}>
        Detalhe + comentário rápido entram em <code>/app/members/[id]/diario</code> (Sprint 31b).
      </p>
    </div>
  )
}
