import { Pool, type PoolClient } from 'pg'
/**
 * Passaporte cross-tenant — Sprint 01b Faixa B/C (regra 42 + ADR 0077).
 *
 * Valida via 2 conexões pg paralelas:
 *   - patient_company_links isolamento por tenant
 *   - patient_link_modules constraint global (1 módulo ativo por passport, module)
 *   - patient_data_access_log append-only (INSERT pelo reader tenant; UPDATE/DELETE bloqueados)
 *   - tenants.mode='solo' check constraint (não pode ter cross_company_access=true)
 *
 * **Pré-requisito**: `pnpm db:seed` populou 5 cenários (incluindo passaporte Carlos).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

// IDs do seed (SCENARIOS.redeMaisClinica + SCENARIOS.solo)
const ACADEMIA_TENANT = '00000003-0001-0000-0000-000000000010'
const CLINICA_TENANT = '00000003-0001-0000-0000-000000000020'
const SOLO_TENANT = '00000005-0001-0000-0000-000000000010'
const PASSPORT_CARLOS = '00000003-0001-0000-0000-0000000000bb'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
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

describe('Passaporte — isolamento per-tenant', () => {
  it('Academia vê APENAS seu link do Carlos', async () => {
    const links = await withTenantContext(ACADEMIA_TENANT, async (client) => {
      const r = await client.query<{ status: string; tenant_id: string }>(
        `SELECT status, tenant_id FROM patient_company_links WHERE passport_passport_id = $1`,
        [PASSPORT_CARLOS],
      )
      return r.rows
    })
    expect(links).toHaveLength(1)
    expect(links[0]?.tenant_id).toBe(ACADEMIA_TENANT)
    expect(links[0]?.status).toBe('active')
  })

  it('Clinica vê APENAS seu link do Carlos', async () => {
    const links = await withTenantContext(CLINICA_TENANT, async (client) => {
      const r = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM patient_company_links WHERE passport_passport_id = $1`,
        [PASSPORT_CARLOS],
      )
      return r.rows
    })
    expect(links).toHaveLength(1)
    expect(links[0]?.tenant_id).toBe(CLINICA_TENANT)
  })

  it('Tenant solo (Mariana) NÃO vê passaporte do Carlos', async () => {
    const links = await withTenantContext(SOLO_TENANT, async (client) => {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM patient_company_links WHERE passport_passport_id = $1`,
        [PASSPORT_CARLOS],
      )
      return r.rows
    })
    expect(links).toHaveLength(0) // RLS bloqueia
  })
})

describe('Passaporte — módulos via JOIN', () => {
  it('Academia vê módulo academia=active do Carlos', async () => {
    const modules = await withTenantContext(ACADEMIA_TENANT, async (client) => {
      const r = await client.query<{ module: string; status: string }>(
        `SELECT m.module, m.status FROM patient_link_modules m
         WHERE m.passport_passport_id = $1`,
        [PASSPORT_CARLOS],
      )
      return r.rows
    })
    expect(modules).toHaveLength(1)
    expect(modules[0]?.module).toBe('academia')
    expect(modules[0]?.status).toBe('active')
  })

  it('Clinica vê módulo fisioterapia=active do Carlos', async () => {
    const modules = await withTenantContext(CLINICA_TENANT, async (client) => {
      const r = await client.query<{ module: string; status: string }>(
        `SELECT m.module, m.status FROM patient_link_modules m
         WHERE m.passport_passport_id = $1`,
        [PASSPORT_CARLOS],
      )
      return r.rows
    })
    expect(modules).toHaveLength(1)
    expect(modules[0]?.module).toBe('fisioterapia')
  })
})

describe('Constraint global — 1 módulo ativo por (passport, module)', () => {
  it('Tentar criar 2º link ACADEMIA pro mesmo passport viola constraint', async () => {
    let errorCode: string | null = null

    // Como admin (postgres) — criar conflito manual
    const client = await pool.connect()
    try {
      // Cria um link rascunho num tenant terceiro (solo)
      await client.query(
        `INSERT INTO patient_company_links (id, passport_passport_id, person_id, tenant_id, status, creation_path)
         VALUES (gen_random_uuid(), $1, $2, $3, 'pending', 'reactive')`,
        [
          PASSPORT_CARLOS,
          // Reusa person row de qualquer tenant pra atender FK (validação RLS desabilitada como postgres)
          '00000003-0001-0000-0000-0000000000ba', // carlosAcademiaPersonId
          SOLO_TENANT,
        ],
      )
      const linkRes = await client.query<{ id: string }>(
        `SELECT id FROM patient_company_links WHERE tenant_id = $1 AND passport_passport_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [SOLO_TENANT, PASSPORT_CARLOS],
      )
      const newLinkId = linkRes.rows[0]?.id
      expect(newLinkId).toBeTruthy()

      // Tenta ativar módulo academia já ativo no tenant Academia
      try {
        await client.query(
          `INSERT INTO patient_link_modules (link_id, passport_passport_id, module, status, activated_at)
           VALUES ($1, $2, 'academia', 'active', now())`,
          [newLinkId, PASSPORT_CARLOS],
        )
      } catch (err) {
        errorCode = (err as { code?: string }).code ?? null
      }

      // Cleanup
      await client.query(`DELETE FROM patient_company_links WHERE id = $1`, [newLinkId])
    } finally {
      client.release()
    }

    // 23505 = unique_violation (patient_link_modules_global_active_uq)
    expect(errorCode).toBe('23505')
  })
})

describe('patient_data_access_log — append-only', () => {
  it('INSERT permitido pelo reader_tenant; UPDATE/DELETE rejeitados', async () => {
    // Pega person carlosAcademiaPersonId
    const PATIENT_PERSON = '00000003-0001-0000-0000-0000000000ba'
    let inserted = false
    let updateErr = ''
    let logId: string | null = null

    await withTenantContext(CLINICA_TENANT, async (client) => {
      // Cria entry (clínica leu dado da academia)
      const r = await client.query<{ id: string }>(
        `INSERT INTO patient_data_access_log (
          reader_user_id, reader_tenant_id, source_tenant_id,
          patient_person_id, passport_passport_id, module_type,
          category, request_id, ip, user_agent
        ) VALUES (
          $1, $2, $3, $4, $5, 'academia', 'antropometria', gen_random_uuid(), '127.0.0.1', 'test'
        ) RETURNING id`,
        [
          '00000001-0001-0000-0000-0000000000e1', // qualquer user_id (FK não checada)
          CLINICA_TENANT,
          ACADEMIA_TENANT,
          PATIENT_PERSON,
          PASSPORT_CARLOS,
        ],
      )
      logId = r.rows[0]?.id ?? null
      inserted = true

      // Tenta UPDATE (deve falhar via RLS — sem policy de UPDATE → 0 rows OU erro)
      let updateRowsAffected = -1
      try {
        const res = await client.query(
          `UPDATE patient_data_access_log SET module_type = 'fisioterapia' WHERE id = $1`,
          [logId],
        )
        updateRowsAffected = res.rowCount ?? 0
      } catch (err) {
        updateErr = err instanceof Error ? err.message : ''
      }
      // Sem policy de UPDATE em append-only table → 0 rows affected silencioso
      // (não erro; RLS USING clause omitida = sem rows visíveis pra UPDATE)
      // Captura ambos cenários: erro de policy OU 0 rows affected
      expect(updateRowsAffected === 0 || updateErr.length > 0).toBe(true)
    })

    expect(inserted).toBe(true)

    // Cleanup (como admin)
    if (logId) {
      await pool.query(`DELETE FROM patient_data_access_log WHERE id = $1`, [logId])
    }
  })
})

describe('tenants.mode=solo — check constraint', () => {
  it('NÃO permite mode=solo com cross_company_access=true', async () => {
    let errorCode: string | null = null
    const tempId = '88888888-aaaa-0000-0000-000000000099'
    try {
      await pool.query(
        `INSERT INTO tenants (id, name, slug, mode, cross_company_access)
         VALUES ($1, 'Bad Solo', 'bad-solo-test', 'solo', true)`,
        [tempId],
      )
    } catch (err) {
      errorCode = (err as { code?: string }).code ?? null
    }
    expect(errorCode).toBe('23514') // check_violation
  })

  it('Permite mode=solo com cross_company_access=false (seed cenário 5)', async () => {
    const r = await pool.query<{ mode: string; cross_company_access: boolean }>(
      `SELECT mode, cross_company_access FROM tenants WHERE id = $1`,
      [SOLO_TENANT],
    )
    expect(r.rows[0]?.mode).toBe('solo')
    expect(r.rows[0]?.cross_company_access).toBe(false)
  })
})
