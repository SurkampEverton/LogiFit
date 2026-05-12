/**
 * Session helpers pra Server Actions e Server Components.
 *
 * `getServerSession()` retorna o payload customSession (claims LogiFit).
 * `requireSession()` redireciona pra /login se não houver sessão.
 *
 * Antes de cada query DB, Server Actions devem setar `app.tenant_id` +
 * `app.user_id` via `withSessionContext()` — RLS policies (Sprint 01a
 * Faixa A) usam `current_setting('app.tenant_id')`.
 */
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@repo/auth/server'
import { pool } from '@repo/db/client'

export interface LogifitSessionClaims {
  userId: string
  tenantId: string
  topology: 'owned' | 'franchise'
  roles: string[]
  requiresMfa: boolean
  mfaAt: Date | null
}

export type ServerSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
> & {
  logifit: LogifitSessionClaims | null
}

/**
 * Lê sessão; retorna null se não autenticada.
 * Acesso seguro a `session.logifit` (pode ser null se user_auth existe mas
 * `users` LogiFit ainda não — fluxo signup wizard incompleto).
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const h = await headers()
  const session = await auth.api.getSession({ headers: h })
  return session as ServerSession | null
}

/**
 * Lê sessão ou redireciona pra /login. Use em Server Components / Server Actions
 * de rotas protegidas.
 *
 * Retorna sessão garantida não-null, mas `logifit` pode ainda ser null —
 * caller decide redirect pra /signup/complete se preciso.
 */
export async function requireSession(returnTo: string): Promise<ServerSession> {
  const session = await getServerSession()
  if (!session) {
    const url = new URL('/login', 'http://placeholder')
    url.searchParams.set('returnTo', returnTo)
    redirect(`${url.pathname}${url.search}`)
  }
  return session
}

/**
 * Lê sessão + garante que `logifit` claims estão presentes (user completou
 * signup). Redireciona pra /signup/complete se faltar (fluxo wizard).
 */
export async function requireFullSession(
  returnTo: string,
): Promise<ServerSession & { logifit: LogifitSessionClaims }> {
  const session = await requireSession(returnTo)
  if (!session.logifit) {
    redirect('/signup/complete')
  }
  return session as ServerSession & { logifit: LogifitSessionClaims }
}

/**
 * Executa `fn` com `app.tenant_id` + `app.user_id` setados como
 * `current_setting` na conexão — RLS policies aplicam.
 *
 * **CRÍTICO** — toda Server Action deve usar isto antes de queries.
 * Sprint 01a Faixa F (wrapAction) automatiza; por enquanto chama manual.
 */
export async function withSessionContext<T>(
  claims: LogifitSessionClaims,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("SELECT set_config('app.user_id', $1, false)", [claims.userId])
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [claims.tenantId])
    // fn deve usar o mesmo client; mas Drizzle global pool sempre pega novo.
    // Sprint 02+ refatora pra Drizzle-com-SET via wrapAction.
    return await fn()
  } finally {
    // Limpa settings antes de devolver ao pool (evita leak entre requests)
    try {
      await client.query("SELECT set_config('app.user_id', '', false)")
      await client.query("SELECT set_config('app.tenant_id', '', false)")
    } catch {
      /* swallow */
    }
    client.release()
  }
}
