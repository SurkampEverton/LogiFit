/**
 * BetterAuth server-side instance (ADR 0092).
 *
 * Configurada pra LogiFit:
 *   - Adapter Drizzle apontando pro nosso `pool` (`@repo/db/client`)
 *   - Schema com prefixo `auth_` (coexiste com nossa `users` table)
 *   - Magic link via email (provider Mailhog em dev, AWS SES em prod)
 *   - twoFactor (TOTP + WebAuthn passkey)
 *   - Cookie name `logifit_session` (default seria `better-auth.session`)
 *   - JWT custom claims via plugin `customSession` (Faixa C — RBAC + JWT)
 *   - Lockout 5 falhas/15min — implementado via `auth_attempts` + `auth_lockouts`
 *     em camada wrapper (BetterAuth tem rate limit in-memory mas não persiste
 *     em DB; nossa regra de auditoria exige rastro em SQL)
 *
 * Uso típico em Server Action / API Route:
 *   import { auth } from '@repo/auth/server'
 *   const session = await auth.api.getSession({ headers })
 *
 * Uso em middleware Next.js:
 *   import { auth } from '@repo/auth/server'
 *   const session = await auth.api.getSession({ headers: request.headers })
 *   if (!session) return Response.redirect(new URL('/login', request.url))
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { toNextJsHandler } from 'better-auth/next-js'
import { customSession, magicLink, twoFactor } from 'better-auth/plugins'
import { and, eq, sql as drizzleSql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  authAccount,
  authPasskey,
  authSession,
  authTwoFactor,
  authUser,
  authVerification,
  roles,
  tenants,
  userRoles,
  userTenants,
  users,
} from '@repo/db/schema'

const DATABASE_URL = process.env.DATABASE_URL
const AUTH_SECRET = process.env.AUTH_SECRET
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'

if (!DATABASE_URL) {
  throw new Error('AUTH: DATABASE_URL não definido — auth não pode iniciar')
}
if (!AUTH_SECRET) {
  throw new Error(
    'AUTH: AUTH_SECRET não definido — gere com `openssl rand -base64 32` e coloque em .env.local',
  )
}

// Pool separado do app principal — facilita rotação de credentials sem
// reiniciar Server Actions ativas. Em prod (Coolify), aponta pro PgBouncer.
//
// **AUTH_DATABASE_URL** (Sprint 01a Faixa B fix — 2026-05-12): aceita override
// pra connection string que **bypassa RLS**, necessária pro customSession
// callback que lookup users/user_tenants/tenants ANTES de saber tenant_id
// (chicken-and-egg). Default = DATABASE_URL pra compatibilidade.
// Fix definitivo: SQL function `get_default_logifit_user(auth_user_id)` com
// SECURITY DEFINER (Sprint 02+).
const AUTH_DATABASE_URL = process.env.AUTH_DATABASE_URL ?? DATABASE_URL
const authPool = new Pool({ connectionString: AUTH_DATABASE_URL })
const authDb = drizzle(authPool, {
  schema: {
    user: authUser,
    session: authSession,
    account: authAccount,
    verification: authVerification,
    twoFactor: authTwoFactor,
    passkey: authPasskey,
  },
})

export const auth = betterAuth({
  database: drizzleAdapter(authDb, {
    provider: 'pg',
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
      twoFactor: authTwoFactor,
      passkey: authPasskey,
    },
  }),

  secret: AUTH_SECRET,
  baseURL: APP_URL,
  basePath: '/api/auth',

  // Cookie LogiFit (soberania perpétua #2 — ADR 0091)
  advanced: {
    cookiePrefix: 'logifit',
    // Em prod (HTTPS): secure=true automático pelo BetterAuth quando baseURL é https.
  },

  // Email/password DESABILITADO no MVP — só magic link + OAuth + WebAuthn
  emailAndPassword: { enabled: false },

  // Magic link via plugin
  plugins: [
    magicLink({
      // Em dev: log no console + Mailhog captura o email
      // Em prod (Sprint 02+): substituir por AWS SES via @repo/email
      sendMagicLink: async ({ email, url, token: _token }) => {
        // Sprint 01a placeholder — log no servidor. Mailhog inbox em dev
        // ainda não está plugado; troca real fica pra final da Faixa B.
        console.log(`[auth] magic link para ${email}: ${url}`)
        // Sprint 00b — Node block-buffera stdout quando piped (não TTY).
        // Append síncrono em arquivo garante visibilidade imediata em dev solo.
        if (process.env.NODE_ENV !== 'production') {
          try {
            const fs = await import('node:fs')
            fs.appendFileSync(
              '.magic-links.dev.log',
              `${new Date().toISOString()} ${email} ${url}\n`,
            )
          } catch {
            /* swallow — arquivo de debug não-bloqueante */
          }
        }
      },
      expiresIn: 60 * 15, // 15 minutos
    }),

    twoFactor({
      issuer: 'LogiFit',
      // TOTP + backup codes via DB (auth_two_factor.backup_codes JSON)
      // WebAuthn (passkey) via plugin separado quando for ativado em Faixa C
    }),

    /**
     * customSession — Faixa C: injeta claims LogiFit no payload de sessão.
     *
     * Claims adicionados:
     *   - tenantId       — tenant ativo (de user_tenants.is_default ou cookie tenant override)
     *   - topology       — owned | franchise (de tenants.topology)
     *   - roles[]        — keys das roles ativas no tenant (sem scope nesta versão MVP)
     *   - requiresMfa    — qualquer role do user tem requires_mfa=true
     *   - mfaAt          — timestamp do último TOTP successful (vem de auth_two_factor
     *                       updatedAt OU de session.activeOrganizationId — Sprint 02+ refina)
     *
     * Sprint 01a Faixa C: lookup direto via authDb. Sprint 04+ vai cache em
     * Redis pra evitar 4 queries por request.
     */
    customSession(async ({ user, session }) => {
      // 1. Acha o LogiFit `users` row default deste auth_user.
      // Sprint 00b Faixa A polish — agrega `username` pra evitar query extra
      // no Server Component (que usaria pool logifit_app + RLS + sem app.tenant_id).
      const userRows = await authDb
        .select({
          userId: users.id,
          tenantId: users.tenantId,
          username: users.username,
        })
        .from(users)
        .innerJoin(userTenants, eq(userTenants.userId, users.id))
        .where(
          and(eq(users.authUserId, drizzleSql`${user.id}::uuid`), eq(userTenants.isDefault, true)),
        )
        .limit(1)

      const userRow = userRows[0]
      if (!userRow) {
        // User auth existe mas ainda não tem `users` row LogiFit — provavelmente
        // está no fluxo de signup wizard (Sprint 01a Faixa E). Retorna session
        // mínima; middleware redireciona pra /signup/complete.
        return { user, session, logifit: null }
      }

      // 2. Tenant info — Sprint 00b Faixa A polish: inclui `name` pra header.
      const tenantRows = await authDb
        .select({ topology: tenants.topology, name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, userRow.tenantId))
        .limit(1)
      const topology = tenantRows[0]?.topology ?? 'owned'
      const tenantName = tenantRows[0]?.name ?? ''

      // 3. Roles ativas
      const roleRows = await authDb
        .select({ key: roles.key, requiresMfa: roles.requiresMfa })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(eq(userRoles.userId, userRow.userId), eq(userRoles.tenantId, userRow.tenantId)),
        )

      const roleKeys = roleRows.map((r) => r.key)
      const requiresMfa = roleRows.some((r) => r.requiresMfa)

      // 4. Permissions ativas (Sprint 00b Faixa C — bulk lookup via SQL function
      //    list_user_permissions). SECURITY DEFINER bypassa RLS interna.
      //    Resultado memoizado no claim de sessão até reauth — admin que mexe
      //    em role/grant precisa user fazer logout/login. Sprint 04+ refresh
      //    via Redis pub/sub se virar dor.
      const permsResult = await authDb.execute<{ list_user_permissions: string[] }>(
        drizzleSql`SELECT list_user_permissions(${userRow.userId}::uuid, ${userRow.tenantId}::uuid) AS list_user_permissions`,
      )
      const permissions =
        (permsResult.rows[0] as { list_user_permissions: string[] } | undefined)
          ?.list_user_permissions ?? []

      return {
        user,
        session,
        logifit: {
          userId: userRow.userId,
          tenantId: userRow.tenantId,
          username: userRow.username,
          tenantName,
          topology,
          roles: roleKeys,
          permissions,
          requiresMfa,
          // mfaAt vem da sessão BetterAuth — quando user completa TOTP, plugin
          // twoFactor atualiza session.twoFactorVerifiedAt. Sprint 01a Faixa C
          // simplifica: usa session.updatedAt como proxy (Sprint 02+ refina).
          mfaAt: session.updatedAt ?? null,
        },
      }
    }),
  ],

  // Rate limiting in-memory do BetterAuth — não substitui auth_attempts/lockouts
  // (que ficam em wrapper LogiFit pra audit + regra ADR 0073).
  rateLimit: {
    enabled: true,
    window: 60, // 60s
    max: 10, // 10 requests por window
  },
})

export type Auth = typeof auth

/**
 * Helper pra Next.js 15 App Router — uso em `app/api/auth/[...all]/route.ts`:
 *   export const { GET, POST } = nextJsHandler(auth)
 *
 * Encapsula `toNextJsHandler` do BetterAuth pra app não precisar declarar
 * `better-auth` como direct dep (fica encapsulado em `@repo/auth`).
 */
export const nextJsHandler = (authInstance: Auth = auth) =>
  toNextJsHandler(authInstance.handler)
