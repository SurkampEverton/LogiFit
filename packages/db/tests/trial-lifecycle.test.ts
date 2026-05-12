/**
 * Trial lifecycle (ADR 0066) — Sprint 01a Faixa G.
 *
 * Testa pipeline:
 *   D+0   tenant criado em /signup       → trialing + trial_ends_at = +14d
 *   D+14  trial_ends_at < now()          → process_trial_lifecycle marks 'trial_expired'
 *   D+44  trial_ends_at + 30d < now()    → anonymize_trial_data() executado:
 *           - persons.name = 'Anonimizado'; document/email/phone/address NULL
 *           - tenants.subscription_status = 'anonymized'
 *           - audit_log entry (action='trial.anonymized', legal_basis)
 *           - agregados preservados
 *
 * **Não usa role logifit_app** — funções são SECURITY DEFINER (admin job).
 * Conexão como `postgres` superuser bypass RLS pra inspeção fácil.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

// UUIDs determinísticos pra este teste (sem colisão com seed canônico)
const TRIAL_TENANT_ACTIVE = '99999999-aaaa-0000-0000-000000000001'
const TRIAL_TENANT_EXPIRED = '99999999-aaaa-0000-0000-000000000002'
const TRIAL_TENANT_OLD = '99999999-aaaa-0000-0000-000000000003'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  // Cleanup defensivo — ordem respeita FK
  const tenantIds = [TRIAL_TENANT_ACTIVE, TRIAL_TENANT_EXPIRED, TRIAL_TENANT_OLD]
  for (const id of tenantIds) {
    await pool.query('DELETE FROM audit_log WHERE tenant_id = $1', [id])
    await pool.query('DELETE FROM persons WHERE tenant_id = $1', [id])
    await pool.query('DELETE FROM tenants WHERE id = $1', [id])
  }
})

async function createTrialTenant(
  id: string,
  slug: string,
  daysAgo: number,
  status: 'trialing' | 'trial_expired' = 'trialing',
) {
  // Cria tenant com trial_ends_at relativo ao now() (negativo = no passado)
  await pool.query(
    `INSERT INTO tenants (id, name, slug, topology, subscription_status, trial_ends_at)
     VALUES ($1, $2, $3, 'owned', $4, NOW() - INTERVAL '${daysAgo} days')`,
    [id, `Trial ${slug}`, slug, status],
  )
  // Cria 1 person PF + 1 person PJ pra testar agregados
  await pool.query(
    `INSERT INTO persons (tenant_id, kind, name, document, email, phone)
     VALUES ($1, 'pf', 'Maria PF', '11144477735', 'maria@test.com', '11999990001'),
            ($1, 'pj', 'Empresa PJ LTDA', '11222333000181', 'empresa@test.com', '1133334444')`,
    [id],
  )
}

describe('process_trial_lifecycle — transições de estado', () => {
  it('trial ATIVO (trial_ends_at +5d no futuro) → NÃO muda', async () => {
    await createTrialTenant(TRIAL_TENANT_ACTIVE, 'active-trial', -5, 'trialing') // ends_at = now() - (-5) = +5d

    await pool.query('SELECT process_trial_lifecycle()')

    const r = await pool.query<{ subscription_status: string }>(
      `SELECT subscription_status FROM tenants WHERE id = $1`,
      [TRIAL_TENANT_ACTIVE],
    )
    expect(r.rows[0]?.subscription_status).toBe('trialing')
  })

  it('trial EXPIRADO (trial_ends_at -1d no passado) → trial_expired', async () => {
    await createTrialTenant(TRIAL_TENANT_EXPIRED, 'expired-trial', 1, 'trialing')

    await pool.query('SELECT process_trial_lifecycle()')

    const r = await pool.query<{ subscription_status: string }>(
      `SELECT subscription_status FROM tenants WHERE id = $1`,
      [TRIAL_TENANT_EXPIRED],
    )
    expect(r.rows[0]?.subscription_status).toBe('trial_expired')
  })

  it('trial_expired + 35d ANONIMIZA + grava audit_log', async () => {
    await createTrialTenant(TRIAL_TENANT_OLD, 'old-trial', 35, 'trial_expired')

    const result = await pool.query<{ process_trial_lifecycle: { newly_anonymized: number } }>(
      `SELECT process_trial_lifecycle() AS process_trial_lifecycle`,
    )
    expect(result.rows[0]?.process_trial_lifecycle.newly_anonymized).toBe(1)

    // Confere status
    const tenant = await pool.query<{ subscription_status: string }>(
      `SELECT subscription_status FROM tenants WHERE id = $1`,
      [TRIAL_TENANT_OLD],
    )
    expect(tenant.rows[0]?.subscription_status).toBe('anonymized')

    // Confere PII NULLificado
    const people = await pool.query<{
      name: string
      document: string | null
      email: string | null
      phone: string | null
    }>(`SELECT name, document, email, phone FROM persons WHERE tenant_id = $1`, [
      TRIAL_TENANT_OLD,
    ])
    expect(people.rows).toHaveLength(2)
    for (const p of people.rows) {
      expect(p.name).toBe('Anonimizado')
      expect(p.document).toBeNull()
      expect(p.email).toBeNull()
      expect(p.phone).toBeNull()
    }

    // Confere audit_log entry
    const audit = await pool.query<{
      action: string
      legal_basis: string | null
      payload: { aggregates_preserved: { persons_count: number } }
    }>(`SELECT action, legal_basis, payload FROM audit_log WHERE tenant_id = $1`, [
      TRIAL_TENANT_OLD,
    ])
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]?.action).toBe('trial.anonymized')
    expect(audit.rows[0]?.legal_basis).toBe('lgpd_art16_eliminacao')
    expect(audit.rows[0]?.payload.aggregates_preserved.persons_count).toBe(2)
  })

  it('idempotente: roda 2× consecutivos sem duplicar audit_log', async () => {
    await createTrialTenant(TRIAL_TENANT_OLD, 'old-idempotent', 35, 'trial_expired')

    await pool.query('SELECT process_trial_lifecycle()')
    await pool.query('SELECT process_trial_lifecycle()')

    const audit = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text FROM audit_log WHERE tenant_id = $1 AND action = 'trial.anonymized'`,
      [TRIAL_TENANT_OLD],
    )
    // 2ª execução não deve criar nova entry — já está anonymized
    expect(Number.parseInt(audit.rows[0]?.count ?? '0', 10)).toBe(1)
  })

  it('agregados preservados: count(persons) mantém 2 após anonimização', async () => {
    await createTrialTenant(TRIAL_TENANT_OLD, 'old-aggregates', 35, 'trial_expired')

    const beforeCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text FROM persons WHERE tenant_id = $1`,
      [TRIAL_TENANT_OLD],
    )
    expect(Number.parseInt(beforeCount.rows[0]?.count ?? '0', 10)).toBe(2)

    await pool.query('SELECT process_trial_lifecycle()')

    const afterCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text FROM persons WHERE tenant_id = $1`,
      [TRIAL_TENANT_OLD],
    )
    expect(Number.parseInt(afterCount.rows[0]?.count ?? '0', 10)).toBe(2)
    // Persons rows NÃO foram DELETE — só UPDATE com NULL em PII
  })
})

describe('anonymize_trial_data — chamada direta', () => {
  it('retorna jsonb com aggregates_preserved + anonymized=true', async () => {
    await createTrialTenant(TRIAL_TENANT_OLD, 'direct-call', 35, 'trial_expired')

    const result = await pool.query<{
      anonymize_trial_data: {
        anonymized: boolean
        aggregates_preserved: { persons_count: number }
      }
    }>(`SELECT anonymize_trial_data($1) AS anonymize_trial_data`, [TRIAL_TENANT_OLD])

    expect(result.rows[0]?.anonymize_trial_data.anonymized).toBe(true)
    expect(result.rows[0]?.anonymize_trial_data.aggregates_preserved.persons_count).toBe(2)
  })

  it('skip se já anonymized (idempotência intra-função)', async () => {
    await createTrialTenant(TRIAL_TENANT_OLD, 'already-anon', 35, 'trial_expired')
    // Primeira chamada
    await pool.query(`SELECT anonymize_trial_data($1)`, [TRIAL_TENANT_OLD])
    // Segunda chamada
    const result = await pool.query<{ anonymize_trial_data: { skipped?: boolean } }>(
      `SELECT anonymize_trial_data($1) AS anonymize_trial_data`,
      [TRIAL_TENANT_OLD],
    )
    expect(result.rows[0]?.anonymize_trial_data.skipped).toBe(true)
  })

  it('raise exception se tenant não existe', async () => {
    let errorCode: string | null = null
    try {
      await pool.query(
        `SELECT anonymize_trial_data('99999999-aaaa-0000-0000-fffffffffffe')`,
      )
    } catch (err) {
      errorCode = (err as { code?: string }).code ?? null
    }
    expect(errorCode).toBe('23503') // foreign_key_violation
  })
})
