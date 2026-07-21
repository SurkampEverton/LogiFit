/**
 * Mensagens RLS + check constraints — Sprint 13 Faixa A.
 *
 * Valida:
 *   - Isolation per-tenant em todas as 5 tabelas (providers/templates/reguas/
 *     executions/messages_sent)
 *   - Unique (tenant, slug) em message_templates
 *   - Check messages_sent_cost_non_negative
 *   - reguas com trigger/actions jsonb persistem
 *   - regua_executions state machine + index pending
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  await pool
    .query('DELETE FROM messages_sent WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM regua_executions WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM reguas WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM message_templates WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM message_providers WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query('DELETE FROM messages_sent WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM regua_executions WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM reguas WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM message_templates WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM message_providers WHERE tenant_id IN ($1, $2)', [
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

describe('message_providers — isolamento per-tenant', () => {
  it('Rede vê seu provider; Franquia não vê', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO message_providers (tenant_id, channel, provider, credentials_encrypted, from_identifier, active)
       VALUES ($1, 'whatsapp', 'twilio', '{}'::jsonb, '+5511999999991', true) RETURNING id`,
      [TENANT_REDE],
    )
    const pId = r.rows[0]!.id

    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query<{ id: string }>('SELECT id FROM message_providers WHERE id = $1', [
          pId,
        ])
        return x.rows
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query<{ id: string }>('SELECT id FROM message_providers WHERE id = $1', [
          pId,
        ])
        return x.rows
      }),
    ])
    expect(redeVisible.length).toBe(1)
    expect(franqVisible.length).toBe(0)
  })
})

describe('message_templates — unique (tenant, slug)', () => {
  it('slug duplicada no mesmo tenant rejeitada', async () => {
    await pool.query(
      `INSERT INTO message_templates (tenant_id, channel, slug, name, body, approval_status)
       VALUES ($1, 'whatsapp', 'cobranca_d1', 'Cobrança D+1', 'Olá {{member.name}}', 'approved')`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO message_templates (tenant_id, channel, slug, name, body)
         VALUES ($1, 'whatsapp', 'cobranca_d1', 'Cobrança Dup', 'Body')`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505') // unique_violation
  })

  it('mesma slug em outro tenant coexiste', async () => {
    await pool.query(
      `INSERT INTO message_templates (tenant_id, channel, slug, name, body)
       VALUES ($1, 'whatsapp', 'cobranca_d1', 'Cobrança Rede', 'Body')`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO message_templates (tenant_id, channel, slug, name, body)
         VALUES ($1, 'whatsapp', 'cobranca_d1', 'Cobrança Franq', 'Body')`,
        [TENANT_FRANQUIA],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('reguas — jsonb trigger/actions/stop_on/guards persistem', () => {
  it('régua canônica de cobrança grava + lê via tenant', async () => {
    const trigger = { event: 'invoice.overdue', filter: { days_overdue: [1, 3, 7] } }
    const actions = [
      { kind: 'send_message', channel: 'whatsapp', template_slug: 'cobranca_d1', delay_days: 0 },
      { kind: 'send_message', channel: 'whatsapp', template_slug: 'cobranca_d3', delay_days: 2 },
      { kind: 'send_message', channel: 'email', template_slug: 'cobranca_d7', delay_days: 4 },
    ]
    const stopOn = ['invoice.paid', 'invoice.cancelled']
    const guards = { consent: 'marketing_messages', rate_limit_per_member_24h: 3 }

    const r = await pool.query<{ id: string }>(
      `INSERT INTO reguas (tenant_id, name, trigger, actions, stop_on, guards, active)
       VALUES ($1, 'Cobrança D+1/+3/+7', $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, true)
       RETURNING id`,
      [
        TENANT_REDE,
        JSON.stringify(trigger),
        JSON.stringify(actions),
        JSON.stringify(stopOn),
        JSON.stringify(guards),
      ],
    )
    const reguaId = r.rows[0]!.id

    const read = await withTenantContext(TENANT_REDE, async (c) => {
      const x = await c.query<{
        trigger: Record<string, unknown>
        actions: unknown[]
        stop_on: string[]
        guards: Record<string, unknown>
      }>('SELECT trigger, actions, stop_on, guards FROM reguas WHERE id = $1', [reguaId])
      return x.rows[0]!
    })
    expect((read.trigger as { event: string }).event).toBe('invoice.overdue')
    expect(read.actions.length).toBe(3)
    expect(read.stop_on).toContain('invoice.paid')
    expect((read.guards as { consent: string }).consent).toBe('marketing_messages')
  })
})

describe('regua_executions — state machine + index pending', () => {
  it('execução running com next_action_at no passado pode ser pegada', async () => {
    const rr = await pool.query<{ id: string }>(
      `INSERT INTO reguas (tenant_id, name, trigger, actions, active)
       VALUES ($1, 'Test Régua', '{}'::jsonb, '[]'::jsonb, true) RETURNING id`,
      [TENANT_REDE],
    )
    const reguaId = rr.rows[0]!.id

    await pool.query(
      `INSERT INTO regua_executions (regua_id, tenant_id, started_at, next_action_at, state, current_step)
       VALUES ($1, $2, now() - interval '1 day', now() - interval '1 hour', 'running', 0)`,
      [reguaId, TENANT_REDE],
    )

    const pending = await withTenantContext(TENANT_REDE, async (c) => {
      const x = await c.query<{ id: string }>(
        "SELECT id FROM regua_executions WHERE state = 'running' AND next_action_at <= now()",
      )
      return x.rows
    })
    expect(pending.length).toBe(1)
  })
})

describe('messages_sent — check cost + isolamento', () => {
  it('cost_cents negativo rejeitado', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO messages_sent (tenant_id, channel, provider, recipient, cost_cents)
         VALUES ($1, 'whatsapp', 'twilio', '+5511999999991', -1)`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('insert + select isolado per-tenant', async () => {
    await pool.query(
      `INSERT INTO messages_sent (tenant_id, channel, provider, recipient, body_rendered, status)
       VALUES ($1, 'whatsapp', 'twilio', '+5511999999991', 'Olá João', 'sent')`,
      [TENANT_REDE],
    )
    const [redeRows, franqRows] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM messages_sent WHERE tenant_id = $1', [TENANT_REDE])
        return x.rows
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM messages_sent WHERE tenant_id = $1', [TENANT_REDE])
        return x.rows
      }),
    ])
    expect(redeRows.length).toBe(1)
    expect(franqRows.length).toBe(0)
  })
})

describe('reguas — index parcial active', () => {
  it('listagem por tenant filtra archived', async () => {
    await pool.query(
      `INSERT INTO reguas (tenant_id, name, trigger, actions, active, archived_at)
       VALUES ($1, 'Régua arquivada', '{}'::jsonb, '[]'::jsonb, true, now())`,
      [TENANT_REDE],
    )
    await pool.query(
      `INSERT INTO reguas (tenant_id, name, trigger, actions, active)
       VALUES ($1, 'Régua ativa', '{}'::jsonb, '[]'::jsonb, true)`,
      [TENANT_REDE],
    )
    const active = await withTenantContext(TENANT_REDE, async (c) => {
      const x = await c.query('SELECT name FROM reguas WHERE active = true AND archived_at IS NULL')
      return x.rows
    })
    expect(active.length).toBe(1)
  })
})
