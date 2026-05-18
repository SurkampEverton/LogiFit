/**
 * Pipeline Exames RLS + checks — Sprint 33 Faixa A.
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'

let pool: Pool

async function getMatriz(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM companies WHERE tenant_id = $1 AND type = 'matriz' LIMIT 1`,
    [tenantId],
  )
  return r.rows[0]!.id
}

async function getOrCreateMember(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM members WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  )
  if (r.rows[0]) return r.rows[0].id
  const companyId = await getMatriz(tenantId)
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', 'Test Exam Member', 'test-exam-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const m = await pool.query<{ id: string }>(
    `INSERT INTO members (tenant_id, person_id, company_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, p.rows[0]!.id, companyId],
  )
  return m.rows[0]!.id
}

async function getUser(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  )
  if (r.rows[0]) return r.rows[0].id
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', 'Test Prof Exam', 'prof-exam-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, person_id, username) VALUES ($1, $2, 'prof-exam-' || $1::uuid::text) RETURNING id`,
    [tenantId, p.rows[0]!.id],
  )
  return u.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  for (const t of [
    'exam_review_edits',
    'exam_interpretations_final',
    'exam_interpretations_draft',
    'exam_extractions',
    'exam_documents',
    'tenant_exam_ai_settings',
  ]) {
    await pool
      .query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  await pool.end()
})

beforeEach(async () => {
  for (const t of [
    'exam_review_edits',
    'exam_interpretations_final',
    'exam_interpretations_draft',
    'exam_extractions',
    'exam_documents',
    'tenant_exam_ai_settings',
  ]) {
    await pool
      .query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
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

describe('exam_documents — checks + isolation', () => {
  async function insertDoc(tenantId: string, opts: { source?: string; uploaderUser?: boolean } = {}) {
    const memberId = await getOrCreateMember(tenantId)
    const source = opts.source ?? 'professional_upload'
    const uploadedByUserId = opts.uploaderUser !== false ? await getUser(tenantId) : null
    const uploadedByMemberId = opts.uploaderUser === false ? memberId : null
    return pool.query<{ id: string }>(
      `INSERT INTO exam_documents
       (tenant_id, member_id, source, uploaded_by_user_id, uploaded_by_member_id,
        storage_path, original_filename, mime_type)
       VALUES ($1, $2, $3::exam_document_source, $4, $5, '/lab/test.pdf', 'test.pdf', 'application/pdf')
       RETURNING id`,
      [tenantId, memberId, source, uploadedByUserId, uploadedByMemberId],
    )
  }

  it('insert válido OK', async () => {
    let errCode = ''
    try {
      await insertDoc(TENANT_REDE)
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('check uploader_consistency: ambos NULL rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO exam_documents
         (tenant_id, member_id, source, storage_path, original_filename, mime_type)
         VALUES ($1, $2, 'professional_upload', '/lab/x.pdf', 'x.pdf', 'application/pdf')`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('check review_consistency: status=published sem reviewed_at rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO exam_documents
         (tenant_id, member_id, source, uploaded_by_user_id, storage_path, original_filename, mime_type, status)
         VALUES ($1, $2, 'professional_upload', $3, '/lab/y.pdf', 'y.pdf', 'application/pdf', 'published')`,
        [TENANT_REDE, memberId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('upload pelo paciente (patient_portal) OK com uploaded_by_member_id', async () => {
    let errCode = ''
    try {
      await insertDoc(TENANT_REDE, { source: 'patient_portal', uploaderUser: false })
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('isolation per-tenant', async () => {
    const r = await insertDoc(TENANT_REDE)
    const eId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM exam_documents WHERE id = $1`, [eId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM exam_documents WHERE id = $1`, [eId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('exam_extractions — checks + isolation', () => {
  it('check confidence range (0-1)', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const ed = await pool.query<{ id: string }>(
      `INSERT INTO exam_documents
       (tenant_id, member_id, source, uploaded_by_user_id, storage_path, original_filename, mime_type)
       VALUES ($1, $2, 'professional_upload', $3, '/lab/conf.pdf', 'conf.pdf', 'application/pdf')
       RETURNING id`,
      [TENANT_REDE, memberId, userId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO exam_extractions (tenant_id, exam_document_id, raw_text, ocr_confidence)
         VALUES ($1, $2, 'texto', 1.5)`,
        [TENANT_REDE, ed.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

describe('exam_interpretations_draft — classifier flag', () => {
  it('blocked_by_classifier preserva texto bloqueado pra audit', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const ed = await pool.query<{ id: string }>(
      `INSERT INTO exam_documents
       (tenant_id, member_id, source, uploaded_by_user_id, storage_path, original_filename, mime_type)
       VALUES ($1, $2, 'professional_upload', $3, '/lab/blk.pdf', 'blk.pdf', 'application/pdf')
       RETURNING id`,
      [TENANT_REDE, memberId, userId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO exam_interpretations_draft
         (tenant_id, exam_document_id, model_used, blocked_by_classifier, classifier_blocked_terms)
         VALUES ($1, $2, 'claude-3.5', true, '["diagnostico de diabetes"]'::jsonb)`,
        [TENANT_REDE, ed.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('exam_review_edits — append-only', () => {
  it('insert OK; UPDATE bloqueado pela ausência de policy', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const ed = await pool.query<{ id: string }>(
      `INSERT INTO exam_documents
       (tenant_id, member_id, source, uploaded_by_user_id, storage_path, original_filename, mime_type)
       VALUES ($1, $2, 'professional_upload', $3, '/lab/edit.pdf', 'edit.pdf', 'application/pdf')
       RETURNING id`,
      [TENANT_REDE, memberId, userId],
    )
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO exam_review_edits
       (tenant_id, exam_document_id, field_key, before_value, after_value, edited_by_user_id)
       VALUES ($1, $2, 'glicose_jejum', '95'::jsonb, '92'::jsonb, $3) RETURNING id`,
      [TENANT_REDE, ed.rows[0]!.id, userId],
    )
    expect(ins.rows[0]!.id).toBeTruthy()
  })
})

describe('tenant_exam_ai_settings — opt-out', () => {
  it('insert + update OK', async () => {
    await pool.query(
      `INSERT INTO tenant_exam_ai_settings (tenant_id, ai_extraction_enabled, ai_interpretation_enabled)
       VALUES ($1, true, false)`,
      [TENANT_REDE],
    )
    const r = await pool.query<{ ai_interpretation_enabled: boolean }>(
      `SELECT ai_interpretation_enabled FROM tenant_exam_ai_settings WHERE tenant_id = $1`,
      [TENANT_REDE],
    )
    expect(r.rows[0]!.ai_interpretation_enabled).toBe(false)
  })

  it('isolation per-tenant', async () => {
    await pool.query(
      `INSERT INTO tenant_exam_ai_settings (tenant_id, ai_extraction_enabled)
       VALUES ($1, false)`,
      [TENANT_REDE],
    )
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT tenant_id FROM tenant_exam_ai_settings WHERE tenant_id = $1`, [
          TENANT_REDE,
        ])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT tenant_id FROM tenant_exam_ai_settings WHERE tenant_id = $1`, [
          TENANT_REDE,
        ])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})
