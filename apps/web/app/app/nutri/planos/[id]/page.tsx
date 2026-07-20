import { db } from '@repo/db/client'
import {
  type MealInput,
  type Nutrients,
  calculateMealPlanNutrition,
  compareAgainstTargets,
  statusEmoji,
} from '@repo/db/nutri'
/**
 * `/app/nutri/planos/[id]` — detalhe do plano com refeições + items + totais
 *   nutricionais calculados + gaps vs targets. Sprint 29 Faixa C.
 *
 * Editor drag-drop completo fica Sprint 29b. Aqui é read-only view server-rendered.
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PlanoDetailPage({ params }: PageProps) {
  const session = await requireFullSession('/app/nutri/planos')
  const tenantId = session.logifit.tenantId
  const { id } = await params

  const [plan] = (
    await db.execute(sql`
      SELECT
        mp.id, mp.name, mp.goal, mp.target_kcal, mp.target_protein_g, mp.target_carb_g,
        mp.target_lipid_g, mp.notes, mp.version, mp.parent_meal_plan_id, mp.active,
        mp.created_at, mp.starts_at, mp.ends_at, mp.member_id,
        (SELECT p.name FROM members m INNER JOIN persons p ON p.id = m.person_id WHERE m.id = mp.member_id) AS member_name
      FROM meal_plans mp
      WHERE mp.id = ${id} AND mp.tenant_id = ${tenantId}
      LIMIT 1
    `)
  ).rows as Array<{
    id: string
    name: string
    goal: string
    target_kcal: number | null
    target_protein_g: string | null
    target_carb_g: string | null
    target_lipid_g: string | null
    notes: string | null
    version: number
    parent_meal_plan_id: string | null
    active: boolean
    created_at: string
    starts_at: string
    ends_at: string | null
    member_id: string
    member_name: string | null
  }>

  if (!plan) {
    return (
      <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
        <h1>Plano não encontrado</h1>
        <Link href="/app/nutri/planos">Voltar</Link>
      </div>
    )
  }

  const meals = (
    await db.execute(sql`
      SELECT id, name, expected_time, "order", notes
      FROM meal_plan_meals
      WHERE meal_plan_id = ${id}
      ORDER BY "order" ASC
    `)
  ).rows as Array<{
    id: string
    name: string
    expected_time: string | null
    order: number
    notes: string | null
  }>

  const items = (
    await db.execute(sql`
      SELECT mi.id, mi.meal_id, mi.food_id, mi.grams, mi.measure, mi.notes, mi."order",
             f.name AS food_name, f.nutrients
      FROM meal_items mi
      INNER JOIN foods f ON f.id = mi.food_id
      WHERE mi.tenant_id = ${tenantId} AND mi.meal_id IN (
        SELECT id FROM meal_plan_meals WHERE meal_plan_id = ${id}
      )
      ORDER BY mi."order" ASC
    `)
  ).rows as Array<{
    id: string
    meal_id: string
    food_id: string
    grams: string
    measure: string | null
    notes: string | null
    order: number
    food_name: string
    nutrients: Nutrients
  }>

  // Agrupa items por meal
  const itemsByMeal = new Map<string, typeof items>()
  for (const it of items) {
    const arr = itemsByMeal.get(it.meal_id) ?? []
    arr.push(it)
    itemsByMeal.set(it.meal_id, arr)
  }

  const mealsInput: MealInput[] = meals.map((m) => ({
    mealId: m.id,
    name: m.name,
    order: m.order,
    items: (itemsByMeal.get(m.id) ?? []).map((it) => ({
      foodId: it.food_id,
      foodName: it.food_name,
      grams: Number(it.grams),
      nutrients: it.nutrients,
    })),
  }))

  const nutrition = calculateMealPlanNutrition(mealsInput)
  const gaps = compareAgainstTargets(nutrition.totals, {
    kcal: plan.target_kcal,
    protein_g: plan.target_protein_g ? Number(plan.target_protein_g) : null,
    carbohydrate_g: plan.target_carb_g ? Number(plan.target_carb_g) : null,
    lipid_g: plan.target_lipid_g ? Number(plan.target_lipid_g) : null,
  })

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
        <h1 style={{ margin: 0 }}>{plan.name}</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          v{plan.version} · {plan.active ? 'ativo' : 'inativo'} ·{' '}
          {plan.member_name ?? plan.member_id}
        </span>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        {gaps.length > 0 ? (
          gaps.map((g) => (
            <div key={g.key}>
              <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
                {g.key}
              </div>
              <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>
                {g.current.toFixed(g.key === 'kcal' ? 0 : 1)}
                <span style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
                  {' '}
                  / {g.target}
                </span>
              </div>
              <div style={{ fontSize: 'var(--ev-text-sm)' }}>
                {statusEmoji(g.status)} {g.delta >= 0 ? '+' : ''}
                {g.delta.toFixed(g.key === 'kcal' ? 0 : 1)}
              </div>
            </div>
          ))
        ) : (
          <div>
            <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
              kcal total
            </div>
            <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>
              {nutrition.totals.kcal?.toFixed(0) ?? '0'}
            </div>
          </div>
        )}
      </section>

      {meals.map((m) => {
        const ms = mealsInput.find((mi) => mi.mealId === m.id)
        const totals = ms ? calculateMealPlanNutrition([ms]).totals : {}
        return (
          <section key={m.id} className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 'var(--ev-space-2)',
              }}
            >
              <h3 style={{ margin: 0 }}>
                {m.order}. {m.name}
                {m.expected_time ? (
                  <span style={{ color: 'var(--ev-text-muted)', fontWeight: 400 }}>
                    {' · '}
                    {m.expected_time}
                  </span>
                ) : null}
              </h3>
              <span style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-sm)' }}>
                {totals.kcal?.toFixed(0) ?? '0'} kcal
              </span>
            </header>
            {(itemsByMeal.get(m.id) ?? []).length === 0 ? (
              <p style={{ color: 'var(--ev-text-muted)' }}>Sem items.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-xs)' }}>
                    <th style={{ textAlign: 'left', padding: 2 }}>Alimento</th>
                    <th style={{ textAlign: 'right', padding: 2 }}>Qtde</th>
                    <th style={{ textAlign: 'right', padding: 2 }}>kcal</th>
                    <th style={{ textAlign: 'right', padding: 2 }}>P</th>
                    <th style={{ textAlign: 'right', padding: 2 }}>C</th>
                    <th style={{ textAlign: 'right', padding: 2 }}>L</th>
                  </tr>
                </thead>
                <tbody>
                  {(itemsByMeal.get(m.id) ?? []).map((it) => {
                    const factor = Number(it.grams) / 100
                    return (
                      <tr key={it.id} style={{ borderTop: '1px solid var(--ev-border)' }}>
                        <td style={{ padding: '4px 2px' }}>{it.food_name}</td>
                        <td
                          style={{
                            padding: '4px 2px',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontSize: 'var(--ev-text-sm)',
                          }}
                        >
                          {Number(it.grams).toFixed(0)}g
                          {it.measure ? (
                            <small style={{ color: 'var(--ev-text-muted)' }}> · {it.measure}</small>
                          ) : null}
                        </td>
                        <td
                          style={{
                            padding: '4px 2px',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontSize: 'var(--ev-text-sm)',
                          }}
                        >
                          {((it.nutrients?.kcal ?? 0) * factor).toFixed(0)}
                        </td>
                        <td
                          style={{
                            padding: '4px 2px',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontSize: 'var(--ev-text-sm)',
                          }}
                        >
                          {((it.nutrients?.protein_g ?? 0) * factor).toFixed(1)}
                        </td>
                        <td
                          style={{
                            padding: '4px 2px',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontSize: 'var(--ev-text-sm)',
                          }}
                        >
                          {((it.nutrients?.carbohydrate_g ?? 0) * factor).toFixed(1)}
                        </td>
                        <td
                          style={{
                            padding: '4px 2px',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontSize: 'var(--ev-text-sm)',
                          }}
                        >
                          {((it.nutrients?.lipid_g ?? 0) * factor).toFixed(1)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
        )
      })}

      {plan.notes ? (
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <h3 style={{ marginTop: 0 }}>Observações</h3>
          <p>{plan.notes}</p>
        </section>
      ) : null}

      <Link href="/app/nutri/planos" className="ev-btn ev-btn-ghost">
        ← Voltar
      </Link>
    </div>
  )
}
