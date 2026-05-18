/**
 * Member session helpers — Sprint 26 Faixa B.2.
 *
 * Portal do Paciente usa cookie próprio (`lf_member_session`) com refresh_token
 * plano. Verify lookup hash em `member_sessions`. Cookie httpOnly + Secure +
 * SameSite=Lax + Path=/meu.
 *
 * **Separação clara do operador** (ADR 0088): cookie distinto, claim JWT
 * `role=member` (vs `role=staff` do BetterAuth). Nunca rotas `/app/*` aceitam
 * cookie de member; nunca `/meu/*` aceita cookie de operador.
 *
 * Sprint 26: cookie carrega refresh token plano direto. Sprint 26b: rotaciona
 * a cada uso (single-use refresh + access JWT 15min separado).
 */
import { pool } from '@repo/db/client'
import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const MEMBER_COOKIE_NAME = 'lf_member_session'
export const MEMBER_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60 // 30d

export interface MemberSessionClaims {
  memberId: string
  tenantId: string
  sessionId: string
  /** Persona ativa derivada do tenant (academia/fisio/nutri/etc) — Sprint 26b: lookup real */
  vertical: 'academia' | 'fisio' | 'nutri' | 'multi'
}

/**
 * Lê member session do cookie. Retorna null se ausente/inválido/expirado/revogado.
 */
export async function getMemberSession(): Promise<MemberSessionClaims | null> {
  const c = await cookies()
  const raw = c.get(MEMBER_COOKIE_NAME)?.value
  if (!raw) return null
  const hash = createHash('sha256').update(raw).digest('hex')

  const r = await pool.query<{
    id: string
    member_id: string
    tenant_id: string
    expires_at: Date
    revoked_at: Date | null
  }>(
    `SELECT id, member_id, tenant_id, expires_at, revoked_at
     FROM member_sessions
     WHERE refresh_token_hash = $1
     LIMIT 1`,
    [hash],
  )
  const row = r.rows[0]
  if (!row) return null
  if (row.revoked_at !== null) return null
  if (row.expires_at.getTime() < Date.now()) return null

  // Update last_seen_at (fire-and-forget)
  void pool.query(`UPDATE member_sessions SET last_seen_at = now() WHERE id = $1`, [row.id]).catch(
    () => {},
  )

  return {
    memberId: row.member_id,
    tenantId: row.tenant_id,
    sessionId: row.id,
    vertical: 'multi', // Sprint 26b: lookup tenant.verticals
  }
}

/**
 * Lê member session ou redireciona pra /meu/login.
 */
export async function requireMemberSession(returnTo: string): Promise<MemberSessionClaims> {
  const session = await getMemberSession()
  if (!session) {
    const url = new URL('/meu/login', 'http://placeholder')
    url.searchParams.set('returnTo', returnTo)
    redirect(`${url.pathname}${url.search}`)
  }
  return session
}

/**
 * Seta cookie de session pro browser do paciente.
 */
export async function setMemberCookie(refreshTokenPlain: string): Promise<void> {
  const c = await cookies()
  c.set(MEMBER_COOKIE_NAME, refreshTokenPlain, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/meu',
    maxAge: MEMBER_COOKIE_MAX_AGE_S,
  })
}

/**
 * Remove cookie (logout).
 */
export async function clearMemberCookie(): Promise<void> {
  const c = await cookies()
  c.delete(MEMBER_COOKIE_NAME)
}

/**
 * Executa `fn` com `app.tenant_id` + `app.member_id` setados (RLS member).
 */
export async function withMemberContext<T>(
  claims: MemberSessionClaims,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [claims.tenantId])
    await client.query("SELECT set_config('app.member_id', $1, false)", [claims.memberId])
    return await fn()
  } finally {
    try {
      await client.query("SELECT set_config('app.tenant_id', '', false)")
      await client.query("SELECT set_config('app.member_id', '', false)")
    } catch {
      /* swallow */
    }
    client.release()
  }
}
