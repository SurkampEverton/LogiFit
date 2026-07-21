/**
 * Avaliações RLS + check constraints + biblioteca global — Sprint 12 Faixa A.
 *
 * Valida:
 *   - Isolation per-tenant em todas as 5 tabelas
 *   - Biblioteca global (assessment_types.tenant_id NULL) visível cross-tenant
 *     via SELECT; INSERT global bloqueado pra app-role
 *   - Check `assessment_measurements_has_value` (1 dos 3 value_* preenchido)
 *   - Check `assessment_measurements_device_requires_validation` (source=device
 *     exige validated_by_user_id + validated_at)
 *   - Unique `assessment_measurements_unique` por (assessment, field_key)
 *   - Unique `assessment_calculations_unique` por (assessment, calc_key)
 *   - Soft-delete preservado em SELECT (RLS não filtra; Server Action sim)
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'

const TEST_PERSON_ID = '99999999-aaaa-aaaa-aaaa-000000000001'
const TEST_MEMBER_ID = '99999999-bbbb-bbbb-bbbb-000000000001'
const GLOBAL_TYPE_ID = '99999999-cccc-cccc-cccc-000000000001'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
  await pool.query(
    `INSERT INTO persons (id, tenant_id, kind, name, document, email)
     VALUES ($1, $2, 'pf', 'Member Avaliacao Teste', '96385274128', 'avaltest@test.local')
     ON CONFLICT (id) DO NOTHING`,
    // CPF dedicado deste teste: 52998224725 é o "CPF válido de exemplo" mais
    // usado e colidiu com a pessoa criada pelo fluxo de convite de contador —
    // o ON CONFLICT (id) não protege contra o unique (tenant, document).
    [TEST_PERSON_ID, TENANT_REDE],
  )
  await pool.query(
    `INSERT INTO members (id, tenant_id, person_id, company_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_MEMBER_ID, TENANT_REDE, TEST_PERSON_ID, REDE_MATRIZ_COMPANY_ID],
  )
  // assessment_type global
  await pool.query(
    `INSERT INTO assessment_types (id, tenant_id, name, category, vertical, fields, version)
     VALUES ($1, NULL, 'Bioimpedância Global', 'composicao_corporal', 'academia',
       $2::jsonb, 1)
     ON CONFLICT (id) DO NOTHING`,
    [
      GLOBAL_TYPE_ID,
      JSON.stringify([
        { key: 'peso_kg', label: 'Peso (kg)', kind: 'number', unit: 'kg', min: 30, max: 250 },
        { key: 'gordura_pct', label: '% Gordura', kind: 'number', unit: '%', min: 0, max: 70 },
      ]),
    ],
  )
})

afterAll(async () => {
  await pool
    .query('DELETE FROM assessment_calculations WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM assessment_photos WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM assessment_measurements WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM assessments WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM assessment_types WHERE id = $1 OR tenant_id IN ($2, $3)', [
      GLOBAL_TYPE_ID,
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool.query('DELETE FROM members WHERE id = $1', [TEST_MEMBER_ID])
  await pool.query('DELETE FROM persons WHERE id = $1', [TEST_PERSON_ID])
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query('DELETE FROM assessment_calculations WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM assessment_photos WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM assessment_measurements WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM assessments WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM assessment_types WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
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

describe('assessment_types — biblioteca global + isolamento', () => {
  it('global (tenant_id NULL) visível a TODO tenant', async () => {
    const [rede, franq] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const r = await c.query<{ id: string }>('SELECT id FROM assessment_types WHERE id = $1', [
          GLOBAL_TYPE_ID,
        ])
        return r.rows
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const r = await c.query<{ id: string }>('SELECT id FROM assessment_types WHERE id = $1', [
          GLOBAL_TYPE_ID,
        ])
        return r.rows
      }),
    ])
    expect(rede.length).toBe(1)
    expect(franq.length).toBe(1)
  })

  it('INSERT com tenant_id NULL via app-role REJEITADO', async () => {
    let errMsg = ''
    await withTenantContext(TENANT_REDE, async (c) => {
      try {
        await c.query(
          `INSERT INTO assessment_types (tenant_id, name, category, fields, version)
           VALUES (NULL, 'Tentativa Global', 'custom', '[]'::jsonb, 1)`,
        )
      } catch (err) {
        errMsg = err instanceof Error ? err.message : ''
      }
    })
    expect(errMsg).toMatch(/row-level security/)
  })

  it('tipo customizado do tenant não vaza pra outro tenant', async () => {
    await pool.query(
      `INSERT INTO assessment_types (tenant_id, name, category, fields, version)
       VALUES ($1, 'Antropometria Custom Rede', 'composicao_corporal', '[]'::jsonb, 1)`,
      [TENANT_REDE],
    )
    const franqVisible = await withTenantContext(TENANT_FRANQUIA, async (c) => {
      const r = await c.query<{ name: string }>(
        "SELECT name FROM assessment_types WHERE name = 'Antropometria Custom Rede'",
      )
      return r.rows
    })
    expect(franqVisible.length).toBe(0)
  })
})

describe('assessments — isolamento per-tenant', () => {
  it('Rede vê seu assessment; Franquia não vê', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO assessments (tenant_id, member_id, assessment_type_id, type_version, performed_at)
       VALUES ($1, $2, $3, 1, now()) RETURNING id`,
      [TENANT_REDE, TEST_MEMBER_ID, GLOBAL_TYPE_ID],
    )
    const aId = r.rows[0]!.id

    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query<{ id: string }>('SELECT id FROM assessments WHERE id = $1', [aId])
        return x.rows
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query<{ id: string }>('SELECT id FROM assessments WHERE id = $1', [aId])
        return x.rows
      }),
    ])
    expect(redeVisible.length).toBe(1)
    expect(franqVisible.length).toBe(0)
  })
})

describe('assessment_measurements — checks + unique', () => {
  async function freshAssessment(): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO assessments (tenant_id, member_id, assessment_type_id, type_version, performed_at)
       VALUES ($1, $2, $3, 1, now()) RETURNING id`,
      [TENANT_REDE, TEST_MEMBER_ID, GLOBAL_TYPE_ID],
    )
    return r.rows[0]!.id
  }

  it('check has_value — todos value_* NULL rejeitado', async () => {
    const aId = await freshAssessment()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO assessment_measurements (tenant_id, assessment_id, field_key)
         VALUES ($1, $2, 'peso_kg')`,
        [TENANT_REDE, aId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('value_num preenchido — aceito', async () => {
    const aId = await freshAssessment()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO assessment_measurements (tenant_id, assessment_id, field_key, value_num)
         VALUES ($1, $2, 'peso_kg', 78.5)`,
        [TENANT_REDE, aId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('unique (assessment, field_key) — duplicado rejeitado', async () => {
    const aId = await freshAssessment()
    await pool.query(
      `INSERT INTO assessment_measurements (tenant_id, assessment_id, field_key, value_num)
       VALUES ($1, $2, 'peso_kg', 78.5)`,
      [TENANT_REDE, aId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO assessment_measurements (tenant_id, assessment_id, field_key, value_num)
         VALUES ($1, $2, 'peso_kg', 80.0)`,
        [TENANT_REDE, aId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('source=device sem validated_by/at REJEITADO', async () => {
    const aId = await freshAssessment()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO assessment_measurements (tenant_id, assessment_id, field_key, value_num, source)
         VALUES ($1, $2, 'peso_kg', 80.0, 'device')`,
        [TENANT_REDE, aId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

describe('assessment_calculations — unique calc_key', () => {
  it('mesmo calc_key duplicado no assessment rejeitado', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO assessments (tenant_id, member_id, assessment_type_id, type_version, performed_at)
       VALUES ($1, $2, $3, 1, now()) RETURNING id`,
      [TENANT_REDE, TEST_MEMBER_ID, GLOBAL_TYPE_ID],
    )
    const aId = r.rows[0]!.id
    await pool.query(
      `INSERT INTO assessment_calculations (tenant_id, assessment_id, calc_key, value)
       VALUES ($1, $2, 'imc', 25.5)`,
      [TENANT_REDE, aId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO assessment_calculations (tenant_id, assessment_id, calc_key, value)
         VALUES ($1, $2, 'imc', 26.0)`,
        [TENANT_REDE, aId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })
})

describe('assessments — soft-delete preserva row (não DELETE policy)', () => {
  it('soft_deleted_at marcado, row continua selectable pelo tenant', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO assessments (tenant_id, member_id, assessment_type_id, type_version, performed_at, soft_deleted_at)
       VALUES ($1, $2, $3, 1, now() - interval '1 day', now())
       RETURNING id`,
      [TENANT_REDE, TEST_MEMBER_ID, GLOBAL_TYPE_ID],
    )
    const aId = r.rows[0]!.id
    const visible = await withTenantContext(TENANT_REDE, async (c) => {
      const x = await c.query<{ id: string; soft_deleted_at: string | null }>(
        'SELECT id, soft_deleted_at FROM assessments WHERE id = $1',
        [aId],
      )
      return x.rows
    })
    expect(visible.length).toBe(1)
    expect(visible[0]!.soft_deleted_at).not.toBeNull()
  })
})
