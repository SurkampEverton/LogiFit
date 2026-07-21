'use server'

import { db } from '@repo/db/client'
import { type UserRow, persons, roles, userRoles, userTenants, users } from '@repo/db/schema'
/**
 * Server Actions de users (operadores do tenant — Sprint 01a Faixa E).
 *
 * `createUser` linka uma `persons` kind=pf existente a um novo `users` row
 * + cria entry em `user_tenants` (default=false; primeiro tenant é o atual)
 * + atribui role(s) selecionadas via `user_roles`.
 *
 * Magic link de convite é enviado pelo BetterAuth com `setPassword: false`
 * — user clica no link e completa enrollment (MFA se role requires_mfa).
 *
 * **Não cria auth_user diretamente** — BetterAuth detecta email novo no
 * sign-in/magic-link e cria automaticamente. Após primeiro login, hook
 * customSession liga auth_user.id ↔ users.auth_user_id (Sprint 02+).
 */
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { requireFullSession, withSessionContext } from '../../../lib/session'

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

// ─── listUsers ────────────────────────────────────────────────────────────
export async function listUsers(): Promise<
  ActionResult<
    Array<UserRow & { personName: string; personEmail: string | null; roleKeys: string[] }>
  >
> {
  const session = await requireFullSession('/app/settings/users')

  return withSessionContext(session.logifit, async () => {
    const rows = await db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        personId: users.personId,
        authUserId: users.authUserId,
        username: users.username,
        mfaEnabled: users.mfaEnabled,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        personName: persons.name,
        personEmail: persons.email,
      })
      .from(users)
      .innerJoin(persons, eq(persons.id, users.personId))
      .where(eq(users.tenantId, session.logifit.tenantId))
      .orderBy(persons.name)

    // Faz fetch das roles separado (Faixa F otimiza com lateral join)
    const userIds = rows.map((r) => r.id)
    const rolesByUser = new Map<string, string[]>()
    if (userIds.length > 0) {
      const allRoles = await db
        .select({ userId: userRoles.userId, key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.tenantId, session.logifit.tenantId))
      for (const r of allRoles) {
        if (!userIds.includes(r.userId)) continue
        const list = rolesByUser.get(r.userId) ?? []
        list.push(r.key)
        rolesByUser.set(r.userId, list)
      }
    }

    const enriched = rows.map((r) => ({
      ...r,
      roleKeys: rolesByUser.get(r.id) ?? [],
    }))

    return { ok: true, data: enriched }
  })
}

// ─── listAvailablePfPersons ───────────────────────────────────────────────
// Persons PF não-arquivadas e que ainda não viraram user (pra dropdown
// "linka existente"). Como `users_tenant_person_uq` impede duplicata,
// filtramos persons sem users row no tenant.
export async function listAvailablePfPersons(): Promise<
  ActionResult<Array<{ id: string; name: string; email: string | null; document: string | null }>>
> {
  const session = await requireFullSession('/app/settings/users/new')

  return withSessionContext(session.logifit, async () => {
    const linked = await db
      .select({ personId: users.personId })
      .from(users)
      .where(eq(users.tenantId, session.logifit.tenantId))
    const linkedSet = new Set(linked.map((r) => r.personId))

    const allPf = await db
      .select({
        id: persons.id,
        name: persons.name,
        email: persons.email,
        document: persons.document,
      })
      .from(persons)
      .where(
        and(
          eq(persons.tenantId, session.logifit.tenantId),
          eq(persons.kind, 'pf'),
          isNull(persons.archivedAt),
        ),
      )
      .orderBy(persons.name)

    const available = allPf.filter((p) => !linkedSet.has(p.id))
    return { ok: true, data: available }
  })
}

// ─── listAssignableRoles ──────────────────────────────────────────────────
// Roles que `tenant_owner` / `gerente` pode atribuir (system + custom do tenant).
// Sprint 01a Faixa E: retorna TODAS as system roles + custom; Sprint 01b
// restringe via permission `user.role.update` + scope.
export async function listAssignableRoles(): Promise<
  ActionResult<Array<{ id: string; key: string; label: string; requiresMfa: boolean }>>
> {
  const session = await requireFullSession('/app/settings/users/new')

  return withSessionContext(session.logifit, async () => {
    // tenant-scope-exempt: `roles` e catalogo global — as 12 linhas tem
    // tenant_id NULL. Filtrar por tenant devolveria vazio.
    const rows = await db
      .select({
        id: roles.id,
        key: roles.key,
        label: roles.label,
        requiresMfa: roles.requiresMfa,
      })
      .from(roles)
      .orderBy(roles.key)
    return { ok: true, data: rows }
  })
}

// ─── createUser ───────────────────────────────────────────────────────────
const createUserInputSchema = z.object({
  personId: z.string().uuid(),
  username: z.string().trim().email(),
  roleIds: z.array(z.string().uuid()).min(1).max(20),
  // Scope opcional (regra 25 — Sprint 01b refina)
  scopeCompanyId: z.string().uuid().optional(),
  scopeUnitId: z.string().uuid().optional(),
})

// wrap-exempt: Sprint 01a Faixa E — envelope manual; Faixa F migra pra wrapAction()
export async function createUser(
  rawInput: z.input<typeof createUserInputSchema>,
): Promise<ActionResult<UserRow & { magicLinkSent: boolean }>> {
  const session = await requireFullSession('/app/settings/users/new')
  const parsed = createUserInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'dados inválidos',
        details: parsed.error.flatten(),
      },
    }
  }
  const input = parsed.data

  return withSessionContext(session.logifit, async () => {
    try {
      // 1. INSERT users
      const [userRow] = await db
        .insert(users)
        .values({
          tenantId: session.logifit.tenantId,
          personId: input.personId,
          authUserId: null, // BetterAuth cria quando user clica no magic link
          username: input.username,
          mfaEnabled: false,
        })
        .returning()
      if (!userRow) {
        return { ok: false, error: { code: 'INTERNAL', message: 'insert users vazio' } }
      }

      // 2. INSERT user_tenants (vínculo non-default — user já tem tenant default
      //    em outro contexto? Não — esse é um user novo. Marcamos default=true.)
      await db.insert(userTenants).values({
        userId: userRow.id,
        tenantId: session.logifit.tenantId,
        isDefault: true,
      })

      // 3. INSERT user_roles (uma row por role atribuída)
      for (const roleId of input.roleIds) {
        await db.insert(userRoles).values({
          tenantId: session.logifit.tenantId,
          userId: userRow.id,
          roleId,
          scopeCompanyId: input.scopeCompanyId ?? null,
          scopeUnitId: input.scopeUnitId ?? null,
          grantedAt: new Date(),
          grantedBy: session.logifit.userId,
        })
      }

      // 4. TODO Faixa E fechamento: enviar magic link via BetterAuth
      //    Aqui ficaria `auth.api.signInMagicLink({ body: { email, callbackURL: '/app' }, headers })`
      //    mas precisa do Request headers — Server Action sem request context
      //    direto. Workaround: criar `auth_verification` token manualmente OU
      //    triggar email via `notification_queue` (Sprint 01a Faixa F).
      //
      //    Por enquanto: cria user; admin compartilha link manualmente.
      const magicLinkSent = false

      return { ok: true, data: { ...userRow, magicLinkSent } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('users_tenant_username_uq')) {
        return { ok: false, error: { code: 'USERNAME_TAKEN', message: 'email já cadastrado' } }
      }
      if (msg.includes('users_tenant_person_uq')) {
        return {
          ok: false,
          error: { code: 'PERSON_ALREADY_USER', message: 'esta pessoa já é user neste tenant' },
        }
      }
      if (msg.includes('kind=pf')) {
        return {
          ok: false,
          error: { code: 'PERSON_NOT_PF', message: 'person_id deve apontar pra PF' },
        }
      }
      return { ok: false, error: { code: 'INTERNAL', message: msg.slice(0, 200) } }
    }
  })
}
