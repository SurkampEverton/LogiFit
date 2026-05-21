/**
 * Helper E2E — cria/limpa identities passport global de teste via pool Postgres.
 *
 * Bypass RLS via `SET row_security = off` (caller é superuser postgres em dev).
 * Cleanup idempotente — DELETE não fail se não existe.
 *
 * Diferente de `test-member.ts` (Sprint 26 member legacy), este cria
 * `passport_global_identities` (Sprint 02b2 ADR 0093) — identidade GLOBAL
 * sem tenant_id.
 */
import crypto from 'node:crypto'
import { Pool } from 'pg'

export interface TestPassportIdentity {
  identityId: string
  email: string
  name: string
  cpf: string
  /** Refresh token plano (cookie). Setado apenas se withSession=true. */
  sessionToken?: string
  sessionId?: string
}

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/logifit',
    })
  }
  return pool
}

export async function closePassportPool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export interface CreateTestPassportIdentityOpts {
  email?: string
  name?: string
  /** Marca email_verified_at=now() (default false — paciente em estado "pendente"). */
  emailVerified?: boolean
  /** Cria session passport ativa + retorna refresh token plano. */
  withSession?: boolean
  /** MFA verified na session (se withSession=true). Default false. */
  mfaVerified?: boolean
}

/**
 * Cria passport identity global de teste. Idempotente — DELETE existing pelo
 * email antes pra não acumular nas re-runs locais.
 */
export async function createTestPassportIdentity(
  opts: CreateTestPassportIdentityOpts = {},
): Promise<TestPassportIdentity> {
  const email = opts.email ?? `e2e-passport-${Date.now()}@logifit.test`
  const name = opts.name ?? 'E2E Passport Test'
  // CPF único (não validado em dev — só formato 11 dígitos)
  const ts = Date.now().toString().slice(-9)
  const rnd = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, '0')
  const cpf = `${ts}${rnd}`

  const client = await getPool().connect()
  try {
    await client.query('SET row_security = off')

    // Cleanup: deleta identity existente pelo email (cascade limpa sessions + tokens)
    await client.query(
      `DELETE FROM passport_global_identities WHERE lower(email) = lower($1)`,
      [email],
    )

    // INSERT identity
    const ins = await client.query<{ id: string }>(
      `INSERT INTO passport_global_identities (
         name, cpf_normalized, email, phone, phone_verified_at,
         password_hash, accepted_terms_at, terms_version,
         accepted_privacy_at, privacy_version, ripd_version_signup,
         signup_path, email_verified_at
       ) VALUES (
         $1, $2, $3, '11888888888', now(),
         'e2e-placeholder-hash', now(), 'v1.0',
         now(), 'v1.0', 'v1.0-test',
         'proactive', $4
       ) RETURNING id`,
      [name, cpf, email, opts.emailVerified ? new Date() : null],
    )
    const identityId = ins.rows[0]!.id

    const result: TestPassportIdentity = { identityId, email, name, cpf }

    if (opts.withSession) {
      const tokenBytes = crypto.randomBytes(32)
      const token = tokenBytes.toString('base64url')
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
      const sess = await client.query<{ id: string }>(
        `INSERT INTO passport_global_sessions (
           passport_global_identity_id, refresh_token_hash, expires_at,
           device_label, ip, mfa_verified_at
         ) VALUES ($1, $2, now() + interval '30 days', 'e2e-test', '127.0.0.1', $3)
         RETURNING id`,
        [identityId, tokenHash, opts.mfaVerified ? new Date() : null],
      )
      result.sessionId = sess.rows[0]!.id
      result.sessionToken = token
    }

    return result
  } finally {
    client.release()
  }
}

/**
 * Apaga identity criada por `createTestPassportIdentity`. FK CASCADE limpa
 * sessions + tokens automaticamente. Tolerante.
 */
export async function deleteTestPassportIdentity(
  identity: TestPassportIdentity,
): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query('SET row_security = off')
    await client.query(`DELETE FROM passport_global_identities WHERE id = $1`, [
      identity.identityId,
    ])
  } catch (err) {
    console.warn(
      '[test-passport-identity] cleanup falhou:',
      err instanceof Error ? err.message : err,
    )
  } finally {
    client.release()
  }
}

/**
 * Insere um token de verification arbitrário pra testar verify/confirm endpoints
 * direto (pula request flow, útil pra E2E focado).
 */
export async function insertEmailVerificationToken(opts: {
  identityId: string
  email: string
  kind: 'signup' | 'change_email'
  newEmail?: string
  ttlHours?: number
}): Promise<{ token: string; tokenHash: string }> {
  const tokenBytes = crypto.randomBytes(32)
  const token = tokenBytes.toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const ttl = opts.ttlHours ?? 24

  const client = await getPool().connect()
  try {
    await client.query('SET row_security = off')
    await client.query(
      `INSERT INTO passport_email_verification_tokens
         (passport_global_identity_id, email, kind, new_email, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6::int * interval '1 hour'))`,
      [
        opts.identityId,
        opts.email,
        opts.kind,
        opts.newEmail ?? null,
        tokenHash,
        ttl,
      ],
    )
  } finally {
    client.release()
  }
  return { token, tokenHash }
}

/**
 * Read identity após mutações (e.g., após confirm change_email asserta
 * email atualizado). Bypass RLS.
 */
export async function readIdentity(identityId: string): Promise<{
  email: string
  email_verified_at: Date | null
  deactivated_at: Date | null
} | null> {
  const client = await getPool().connect()
  try {
    await client.query('SET row_security = off')
    const r = await client.query<{
      email: string
      email_verified_at: Date | null
      deactivated_at: Date | null
    }>(
      `SELECT email, email_verified_at, deactivated_at
       FROM passport_global_identities WHERE id = $1 LIMIT 1`,
      [identityId],
    )
    return r.rows[0] ?? null
  } finally {
    client.release()
  }
}

/**
 * Conta tokens de uma identity por kind — pra asserts em E2E (resend deve
 * gerar +1 token; cooldown não deve gerar etc).
 */
export async function countEmailVerificationTokens(opts: {
  identityId: string
  kind?: 'signup' | 'change_email'
}): Promise<number> {
  const client = await getPool().connect()
  try {
    await client.query('SET row_security = off')
    const q = opts.kind
      ? `SELECT count(*)::int AS count FROM passport_email_verification_tokens
         WHERE passport_global_identity_id = $1 AND kind = $2`
      : `SELECT count(*)::int AS count FROM passport_email_verification_tokens
         WHERE passport_global_identity_id = $1`
    const params = opts.kind ? [opts.identityId, opts.kind] : [opts.identityId]
    const r = await client.query<{ count: number }>(q, params)
    return r.rows[0]?.count ?? 0
  } finally {
    client.release()
  }
}
