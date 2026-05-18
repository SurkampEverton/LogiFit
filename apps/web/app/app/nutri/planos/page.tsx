/**
 * `/app/nutri/planos` — lista de planos alimentares (Sprint 29 Faixa C).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const GOAL_LABEL: Record<string, string> = {
  emagrecimento: 'Emagrecimento',
  ganho_massa: 'Ganho de massa',
  manutencao: 'Manutenção',
  baixo_carbo: 'Low carb',
  cetogenico: 'Cetogênico',
  vegetariano: 'Vegetariano',
  vegano: 'Vegano',
  diabetico: 'Diabético',
  renal: 'Renal',
  gestante: 'Gestante',
  esportivo: 'Esportivo',
  outro: 'Outro',
}

interface PageProps {
  searchParams: Promise<{ active?: string }>
}

export default async function PlanosListPage({ searchParams }: PageProps) {
  const session = await requireFullSession('/app/nutri/planos')
  const tenantId = session.logifit.tenantId
  const { active } = await searchParams
  const onlyActive = active !== 'false'

  const rows = (
    await db.execute(sql`
      SELECT
        mp.id, mp.name, mp.goal, mp.target_kcal, mp.version, mp.active, mp.created_at,
        mp.member_id,
        (SELECT p.name FROM members m INNER JOIN persons p ON p.id = m.person_id WHERE m.id = mp.member_id) AS member_name
      FROM meal_plans mp
      WHERE mp.tenant_id = ${tenantId}
        ${onlyActive ? sql`AND mp.active = true` : sql``}
      ORDER BY mp.created_at DESC
      LIMIT 100
    `)
  ).rows as Array<{
    id: string
    name: string
    goal: string
    target_kcal: number | null
    version: number
    active: boolean
    created_at: string
    member_id: string
    member_name: string | null
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)', flexWrap: 'wrap' }}
      >
        <h1 style={{ margin: 0 }}>Planos alimentares</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          {rows.length} plano{rows.length === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <nav style={{ display: 'flex', gap: 'var(--ev-space-sm)' }}>
          <Link
            href="/app/nutri/planos"
            className="ev-btn ev-btn-ghost"
            style={{ fontWeight: onlyActive ? 600 : 400 }}
          >
            Ativos
          </Link>
          <Link
            href="/app/nutri/planos?active=false"
            className="ev-btn ev-btn-ghost"
            style={{ fontWeight: !onlyActive ? 600 : 400 }}
          >
            Todos
          </Link>
        </nav>
      </header>

      <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--ev-surface-muted)' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Plano</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Paciente</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Objetivo</th>
              <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>kcal alvo</th>
              <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>versão</th>
              <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>status</th>
              <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>criado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{ padding: 'var(--ev-space-md)', color: 'var(--ev-text-muted)' }}
                >
                  Nenhum plano. Crie via tela do paciente em /app/members ou via Server Action
                  createMealPlan.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--ev-border)' }}>
                <td style={{ padding: 'var(--ev-space-2)' }}>
                  <Link href={`/app/nutri/planos/${r.id}`}>{r.name}</Link>
                </td>
                <td style={{ padding: 'var(--ev-space-2)' }}>{r.member_name ?? '—'}</td>
                <td style={{ padding: 'var(--ev-space-2)', color: 'var(--ev-text-muted)' }}>
                  {GOAL_LABEL[r.goal] ?? r.goal}
                </td>
                <td style={{ padding: 'var(--ev-space-2)', textAlign: 'right', fontFamily: 'monospace' }}>
                  {r.target_kcal ?? '—'}
                </td>
                <td style={{ padding: 'var(--ev-space-2)', textAlign: 'right' }}>v{r.version}</td>
                <td style={{ padding: 'var(--ev-space-2)', textAlign: 'right' }}>
                  {r.active ? (
                    <span style={{ color: 'var(--ev-success)' }}>● ativo</span>
                  ) : (
                    <span style={{ color: 'var(--ev-text-muted)' }}>inativo</span>
                  )}
                </td>
                <td style={{ padding: 'var(--ev-space-2)', textAlign: 'right' }}>
                  {new Date(r.created_at).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
