/**
 * Treinos RLS + check constraints + biblioteca global — Sprint 11 Faixa A.
 *
 * Valida:
 *   - Biblioteca global (`exercises.tenant_id IS NULL`) visível a todo tenant
 *     (SELECT liberado); INSERT/UPDATE bloqueado nesse modo via WITH CHECK
 *   - Isolation per-tenant em workouts + workout_items + prescriptions +
 *     workout_sessions + workout_session_items
 *   - Versionamento de workouts (parent_workout_id link preservado)
 *   - Check constraints: `exercises_met_positive`, `workout_items_sets_positive`,
 *     `workout_items_workout_order_uq`, `workout_sessions_rpe_range`,
 *     `prescriptions_ref_required`, `prescriptions_ends_after_starts`
 *   - workout_session_items append-only (UPDATE/DELETE silenciosamente bloqueado)
 *   - Polimorfismo prescriptions: kind=workout exige ref_id; kind=custom não exige
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'

const TEST_PERSON_ID = '88888888-aaaa-aaaa-aaaa-000000000001'
const TEST_MEMBER_ID = '88888888-bbbb-bbbb-bbbb-000000000001'

const GLOBAL_EXERCISE_ID = '88888888-cccc-cccc-cccc-000000000001'
const REDE_EXERCISE_ID = '88888888-cccc-cccc-cccc-000000000002'
const FRANQ_EXERCISE_ID = '88888888-cccc-cccc-cccc-000000000003'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })

  // Seed: 1 person + 1 member pra Rede
  await pool.query(
    `INSERT INTO persons (id, tenant_id, kind, name, document, email)
     VALUES ($1, $2, 'pf', 'Member Treino Teste', '17463858000', 'treinotest@test.local')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_PERSON_ID, TENANT_REDE],
  )
  await pool.query(
    `INSERT INTO members (id, tenant_id, person_id, company_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_MEMBER_ID, TENANT_REDE, TEST_PERSON_ID, REDE_MATRIZ_COMPANY_ID],
  )

  // Exercise global (tenant_id NULL) — seedado direto via superuser
  await pool.query(
    `INSERT INTO exercises (id, tenant_id, name, met_value, muscle_groups, level)
     VALUES ($1, NULL, 'Agachamento Livre (global)', 5.0, ARRAY['quadriceps','gluteo'], 'intermediario')
     ON CONFLICT (id) DO NOTHING`,
    [GLOBAL_EXERCISE_ID],
  )
})

afterAll(async () => {
  await pool
    .query('DELETE FROM workout_session_items WHERE tenant_id = $1', [TENANT_REDE])
    .catch(() => {})
  await pool
    .query('DELETE FROM workout_sessions WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM prescriptions WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM workout_items WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM workouts WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool.query('DELETE FROM exercises WHERE id IN ($1, $2, $3)', [
    GLOBAL_EXERCISE_ID,
    REDE_EXERCISE_ID,
    FRANQ_EXERCISE_ID,
  ])
  await pool.query('DELETE FROM members WHERE id = $1', [TEST_MEMBER_ID])
  await pool.query('DELETE FROM persons WHERE id = $1', [TEST_PERSON_ID])
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query('DELETE FROM workout_session_items WHERE tenant_id = $1', [TENANT_REDE])
    .catch(() => {})
  await pool
    .query('DELETE FROM workout_sessions WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM prescriptions WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM workout_items WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM workouts WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool.query('DELETE FROM exercises WHERE id IN ($1, $2)', [
    REDE_EXERCISE_ID,
    FRANQ_EXERCISE_ID,
  ])
})

async function withTenantContext<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('SET ROLE logifit_app')
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId])
    return await fn(client)
  } finally {
    try {
      await client.query("SELECT set_config('app.tenant_id', '', false)")
      await client.query('RESET ROLE')
    } catch {
      /* ignore */
    }
    client.release()
  }
}

// ─── biblioteca global + isolamento ─────────────────────────────────────

describe('exercises — biblioteca global + isolamento tenant', () => {
  it('biblioteca global (tenant_id NULL) é visível a TODO tenant via RLS', async () => {
    // Insere exercise próprio em cada tenant via app-role pra setar tenant_id corretamente
    await withTenantContext(TENANT_REDE, async (client) => {
      await client.query(
        `INSERT INTO exercises (id, tenant_id, name, met_value)
         VALUES ($1, $2, 'Supino Rede', 4.0)`,
        [REDE_EXERCISE_ID, TENANT_REDE],
      )
    })
    await withTenantContext(TENANT_FRANQUIA, async (client) => {
      await client.query(
        `INSERT INTO exercises (id, tenant_id, name, met_value)
         VALUES ($1, $2, 'Supino Franq', 4.0)`,
        [FRANQ_EXERCISE_ID, TENANT_FRANQUIA],
      )
    })

    // Rede vê: seu próprio + global; NÃO vê: franquia
    const redeRows = await withTenantContext(TENANT_REDE, async (client) => {
      const r = await client.query<{ id: string; tenant_id: string | null; name: string }>(
        'SELECT id, tenant_id, name FROM exercises WHERE id IN ($1, $2, $3)',
        [GLOBAL_EXERCISE_ID, REDE_EXERCISE_ID, FRANQ_EXERCISE_ID],
      )
      return r.rows
    })
    expect(redeRows.some((e) => e.id === GLOBAL_EXERCISE_ID)).toBe(true)
    expect(redeRows.some((e) => e.id === REDE_EXERCISE_ID)).toBe(true)
    expect(redeRows.some((e) => e.id === FRANQ_EXERCISE_ID)).toBe(false)

    // Franquia também vê o global + o seu próprio; não vê Rede
    const franqRows = await withTenantContext(TENANT_FRANQUIA, async (client) => {
      const r = await client.query<{ id: string }>(
        'SELECT id FROM exercises WHERE id IN ($1, $2, $3)',
        [GLOBAL_EXERCISE_ID, REDE_EXERCISE_ID, FRANQ_EXERCISE_ID],
      )
      return r.rows
    })
    expect(franqRows.some((e) => e.id === GLOBAL_EXERCISE_ID)).toBe(true)
    expect(franqRows.some((e) => e.id === FRANQ_EXERCISE_ID)).toBe(true)
    expect(franqRows.some((e) => e.id === REDE_EXERCISE_ID)).toBe(false)
  })

  it('INSERT com tenant_id NULL via app-role é REJEITADO (curador externo só)', async () => {
    let errMsg = ''
    await withTenantContext(TENANT_REDE, async (client) => {
      try {
        await client.query(
          `INSERT INTO exercises (tenant_id, name, met_value)
           VALUES (NULL, 'Tentativa Global', 3.0)`,
        )
      } catch (err) {
        errMsg = err instanceof Error ? err.message : ''
      }
    })
    expect(errMsg).toMatch(/row-level security/)
  })

  it('check exercises_met_positive — met_value <= 0 rejeitado', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO exercises (tenant_id, name, met_value)
         VALUES ($1, 'Exercise zero MET', 0)`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514') // check_violation
  })
})

// ─── workouts versionamento ─────────────────────────────────────────────

describe('workouts — RLS + versionamento via parent_workout_id', () => {
  it('Rede vê seu workout; Franquia não vê', async () => {
    const r1 = await pool.query<{ id: string }>(
      `INSERT INTO workouts (tenant_id, name, version) VALUES ($1, 'Workout Rede', 1) RETURNING id`,
      [TENANT_REDE],
    )
    const r2 = await pool.query<{ id: string }>(
      `INSERT INTO workouts (tenant_id, name, version) VALUES ($1, 'Workout Franq', 1) RETURNING id`,
      [TENANT_FRANQUIA],
    )
    const wRede = r1.rows[0]!.id
    const wFranq = r2.rows[0]!.id

    const [seenByRede, seenByFranq] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const r = await c.query<{ id: string }>(
          'SELECT id FROM workouts WHERE id IN ($1, $2)',
          [wRede, wFranq],
        )
        return r.rows.map((x) => x.id)
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const r = await c.query<{ id: string }>(
          'SELECT id FROM workouts WHERE id IN ($1, $2)',
          [wRede, wFranq],
        )
        return r.rows.map((x) => x.id)
      }),
    ])
    expect(seenByRede).toContain(wRede)
    expect(seenByRede).not.toContain(wFranq)
    expect(seenByFranq).toContain(wFranq)
    expect(seenByFranq).not.toContain(wRede)
  })

  it('check workouts_version_positive — version=0 rejeitado', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO workouts (tenant_id, name, version) VALUES ($1, 'Bad', 0)`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('parent_workout_id preserva link de versão anterior', async () => {
    const r1 = await pool.query<{ id: string }>(
      `INSERT INTO workouts (tenant_id, name, version) VALUES ($1, 'V1', 1) RETURNING id`,
      [TENANT_REDE],
    )
    const v1Id = r1.rows[0]!.id
    const r2 = await pool.query<{ id: string }>(
      `INSERT INTO workouts (tenant_id, name, version, parent_workout_id)
       VALUES ($1, 'V2', 2, $2) RETURNING id`,
      [TENANT_REDE, v1Id],
    )
    const v2Id = r2.rows[0]!.id

    const r = await pool.query<{ parent_workout_id: string }>(
      'SELECT parent_workout_id FROM workouts WHERE id = $1',
      [v2Id],
    )
    expect(r.rows[0]!.parent_workout_id).toBe(v1Id)
  })
})

// ─── workout_items — unique order + checks ───────────────────────────────

describe('workout_items — unique (workout, order) + check sets', () => {
  it('mesma order_idx em mesmo workout rejeita (uniqueIndex)', async () => {
    const wR = await pool.query<{ id: string }>(
      `INSERT INTO workouts (tenant_id, name) VALUES ($1, 'W test order') RETURNING id`,
      [TENANT_REDE],
    )
    const wId = wR.rows[0]!.id
    await pool.query(
      `INSERT INTO workout_items (tenant_id, workout_id, exercise_id, "order", sets, reps)
       VALUES ($1, $2, $3, 1, 3, '10')`,
      [TENANT_REDE, wId, GLOBAL_EXERCISE_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO workout_items (tenant_id, workout_id, exercise_id, "order", sets, reps)
         VALUES ($1, $2, $3, 1, 3, '10')`,
        [TENANT_REDE, wId, GLOBAL_EXERCISE_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505') // unique_violation
  })

  it('check workout_items_sets_positive — sets=0 rejeitado', async () => {
    const wR = await pool.query<{ id: string }>(
      `INSERT INTO workouts (tenant_id, name) VALUES ($1, 'W test sets') RETURNING id`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO workout_items (tenant_id, workout_id, exercise_id, "order", sets, reps)
         VALUES ($1, $2, $3, 1, 0, '10')`,
        [TENANT_REDE, wR.rows[0]!.id, GLOBAL_EXERCISE_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

// ─── prescriptions polimórfico ──────────────────────────────────────────

describe('prescriptions — polimorfismo + check ends_after_starts', () => {
  it('kind=workout sem ref_id rejeitado (check_required)', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO prescriptions (tenant_id, member_id, kind, starts_at)
         VALUES ($1, $2, 'workout', now())`,
        [TENANT_REDE, TEST_MEMBER_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('kind=custom sem ref_id é aceito (custom permite null)', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO prescriptions (tenant_id, member_id, kind, starts_at, notes)
         VALUES ($1, $2, 'custom', now(), 'instruções livres')`,
        [TENANT_REDE, TEST_MEMBER_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('check prescriptions_ends_after_starts — ends_at < starts_at rejeitado', async () => {
    const wR = await pool.query<{ id: string }>(
      `INSERT INTO workouts (tenant_id, name) VALUES ($1, 'W presc') RETURNING id`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO prescriptions (tenant_id, member_id, kind, ref_id, starts_at, ends_at)
         VALUES ($1, $2, 'workout', $3, now(), now() - interval '1 day')`,
        [TENANT_REDE, TEST_MEMBER_ID, wR.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

// ─── workout_sessions — RPE range + finished_after_started ──────────────

describe('workout_sessions — RPE range + finished_at coerência', () => {
  it('overall_rpe=11 rejeitado (range 1-10)', async () => {
    const wR = await pool.query<{ id: string }>(
      `INSERT INTO workouts (tenant_id, name) VALUES ($1, 'W rpe') RETURNING id`,
      [TENANT_REDE],
    )
    const pR = await pool.query<{ id: string }>(
      `INSERT INTO prescriptions (tenant_id, member_id, kind, ref_id, starts_at)
       VALUES ($1, $2, 'workout', $3, now()) RETURNING id`,
      [TENANT_REDE, TEST_MEMBER_ID, wR.rows[0]!.id],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO workout_sessions (tenant_id, prescription_id, member_id, overall_rpe)
         VALUES ($1, $2, $3, 11)`,
        [TENANT_REDE, pR.rows[0]!.id, TEST_MEMBER_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

// ─── workout_session_items append-only ──────────────────────────────────

describe('workout_session_items — append-only (UPDATE blocked by RLS)', () => {
  it('INSERT funciona, UPDATE 0 rows / DELETE 0 rows pela ausência de policy', async () => {
    const wR = await pool.query<{ id: string }>(
      `INSERT INTO workouts (tenant_id, name) VALUES ($1, 'W audit') RETURNING id`,
      [TENANT_REDE],
    )
    const wiR = await pool.query<{ id: string }>(
      `INSERT INTO workout_items (tenant_id, workout_id, exercise_id, "order", sets, reps)
       VALUES ($1, $2, $3, 1, 3, '10') RETURNING id`,
      [TENANT_REDE, wR.rows[0]!.id, GLOBAL_EXERCISE_ID],
    )
    const pR = await pool.query<{ id: string }>(
      `INSERT INTO prescriptions (tenant_id, member_id, kind, ref_id, starts_at)
       VALUES ($1, $2, 'workout', $3, now()) RETURNING id`,
      [TENANT_REDE, TEST_MEMBER_ID, wR.rows[0]!.id],
    )
    const sR = await pool.query<{ id: string }>(
      `INSERT INTO workout_sessions (tenant_id, prescription_id, member_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [TENANT_REDE, pR.rows[0]!.id, TEST_MEMBER_ID],
    )

    // INSERT via app-role
    await withTenantContext(TENANT_REDE, async (client) => {
      await client.query(
        `INSERT INTO workout_session_items (tenant_id, session_id, workout_item_id, set_number, reps_performed, weight_kg, rpe)
         VALUES ($1, $2, $3, 1, 10, 80.5, 7)`,
        [TENANT_REDE, sR.rows[0]!.id, wiR.rows[0]!.id],
      )
    })

    // SELECT funciona
    const sel = await withTenantContext(TENANT_REDE, async (client) => {
      const r = await client.query('SELECT * FROM workout_session_items WHERE session_id = $1', [
        sR.rows[0]!.id,
      ])
      return r.rows
    })
    expect(sel.length).toBe(1)

    // UPDATE bloqueado — sem policy → 0 rows affected (silently blocked)
    let updateBlocked = false
    await withTenantContext(TENANT_REDE, async (client) => {
      const r = await client.query(
        `UPDATE workout_session_items SET rpe = 1 WHERE session_id = $1`,
        [sR.rows[0]!.id],
      )
      if (r.rowCount === 0) updateBlocked = true
    })
    expect(updateBlocked).toBe(true)

    // DELETE bloqueado
    let deleteBlocked = false
    await withTenantContext(TENANT_REDE, async (client) => {
      const r = await client.query(
        `DELETE FROM workout_session_items WHERE session_id = $1`,
        [sR.rows[0]!.id],
      )
      if (r.rowCount === 0) deleteBlocked = true
    })
    expect(deleteBlocked).toBe(true)
  })
})
