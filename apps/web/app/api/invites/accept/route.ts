/**
 * POST /api/invites/accept — aceite de convite de staff (Sprint 01c, ADR 0103).
 *
 * Pré-auth (público). Valida token (sha256 + TTL + não usado/revogado) e
 * provisiona NA MESMA transação elevada: auth_user (reusa se email já existe
 * globalmente) → persons PF → users → user_tenants → user_roles
 * (role global do convite) → marca accepted.
 *
 * **Não cria sessão** — usuário entra via magic link normal no /login
 * (evita session fixation via link de email). Erros de token são genéricos
 * (não vaza se expirou/foi revogado/nunca existiu).
 *
 * Contexto elevado: mesmo mecanismo do signup wizard (withElevatedContext) —
 * este arquivo é onboarding pré-auth; o lint futuro `no-elevated-context-abuse`
 * deve permitir aqui junto com signup/actions.ts.
 */
import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withElevatedContext } from '../../../lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const AcceptSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().min(2).max(200),
  document: z
    .string()
    .max(18)
    .optional()
    .transform((v) => {
      const digits = v?.replace(/\D/g, '') ?? ''
      return digits.length === 11 || digits.length === 14 ? digits : null
    }),
})

/**
 * Erro genérico do token (não vaza se expirou/foi revogado/nunca existiu).
 * É função, não constante: `NextResponse` carrega um body stream de uso único —
 * reusar a mesma instância entre requests devolve corpo vazio na segunda.
 */
function genericInvalid(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Convite inválido, expirado ou já utilizado' },
    },
    { status: 400 },
  )
}

export async function POST(request: Request) {
  let parsed: z.infer<typeof AcceptSchema>
  try {
    parsed = AcceptSchema.parse(await request.json())
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'payload inválido' } },
      { status: 400 },
    )
  }
  const tokenHash = createHash('sha256').update(parsed.token).digest('hex')
  const newAuthUserId = randomUUID()

  try {
    const result = await withElevatedContext(newAuthUserId, async (client) => {
      // 1. Lock do convite válido
      const inviteRes = await client.query<{
        id: string
        tenant_id: string
        email: string
        role_key: string
      }>(
        `SELECT id, tenant_id, email, role_key FROM user_invites
         WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL
           AND expires_at > now()
         FOR UPDATE`,
        [tokenHash],
      )
      const invite = inviteRes.rows[0]
      if (!invite) return { ok: false as const }

      // 2. Role global do convite
      const roleRes = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE key = $1 AND tenant_id IS NULL LIMIT 1`,
        [invite.role_key],
      )
      const role = roleRes.rows[0]
      if (!role) throw new Error(`role global ${invite.role_key} não encontrada`)

      // 3. auth_user — reusa se o email já existe globalmente (multi-tenant)
      const existingAuthRes = await client.query<{ id: string }>(
        `SELECT id FROM auth_user WHERE lower(email) = lower($1) LIMIT 1`,
        [invite.email],
      )
      const authUserId = existingAuthRes.rows[0]?.id ?? newAuthUserId
      if (!existingAuthRes.rows[0]) {
        await client.query(
          `INSERT INTO auth_user (id, email, email_verified, name, created_at, updated_at)
           VALUES ($1, $2, true, $3, now(), now())`,
          [authUserId, invite.email, parsed.name],
        )
      }

      // 4. users deste tenant já existe pro email? (defesa — SA de criação já checa)
      const existingUserRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE tenant_id = $1 AND username = $2 LIMIT 1`,
        [invite.tenant_id, invite.email],
      )
      if (existingUserRes.rows[0]) return { ok: false as const }

      // 5. persons PF + users + user_tenants + user_roles
      const personRes = await client.query<{ id: string }>(
        `INSERT INTO persons (tenant_id, kind, name, document, email)
         VALUES ($1, 'pf', $2, $3, $4) RETURNING id`,
        [invite.tenant_id, parsed.name, parsed.document, invite.email],
      )
      const personId = personRes.rows[0]?.id
      if (!personId) throw new Error('insert persons não retornou id')

      const userRes = await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, person_id, auth_user_id, username, mfa_enabled)
         VALUES ($1, $2, $3::uuid, $4, false) RETURNING id`,
        [invite.tenant_id, personId, authUserId, invite.email],
      )
      const userId = userRes.rows[0]?.id
      if (!userId) throw new Error('insert users não retornou id')

      await client.query(
        `INSERT INTO user_tenants (user_id, tenant_id, is_default) VALUES ($1, $2, true)`,
        [userId, invite.tenant_id],
      )
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`,
        [invite.tenant_id, userId, role.id],
      )

      await client.query(
        `UPDATE user_invites SET accepted_at = now(), accepted_user_id = $2 WHERE id = $1`,
        [invite.id, userId],
      )
      return { ok: true as const, email: invite.email }
    })

    if (!result.ok) return genericInvalid()
    return NextResponse.json({ ok: true, data: { email: result.email } })
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'invite_accept_failed',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Erro ao processar convite' } },
      { status: 500 },
    )
  }
}
