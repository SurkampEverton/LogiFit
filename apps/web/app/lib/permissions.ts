/**
 * Permissions helper — Sprint 37b (ADR 0019).
 *
 * Wrapper TS sobre a função SQL `has_permission(user_id, permission, scope_type?, scope_id?)`
 * (policy 0013). Union de `user_roles` + `user_permission_grants` ativos com
 * respeito a `expires_at`/`revoked_at`/scope.
 *
 * **Uso típico** em Server Action:
 *
 *   import { requirePermission } from '@/app/lib/permissions'
 *
 *   async (input, { session }) => {
 *     await requirePermission(session.user.id, 'fiscal.apuracao.write')
 *     // ... handler
 *   }
 *
 * **Throw padrão**: lança `ApiException` com code 'FORBIDDEN' — envelope ADR 0071
 * mapeia pra HTTP 403 + toast user-facing.
 */
import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'

/**
 * Verifica se o user tem permission. Retorna boolean.
 *
 * Não lança — pra controle de visibilidade (UI condicional). Pra gate de
 * action, use `requirePermission`.
 */
export async function hasPermission(
  userId: string,
  permission: string,
  scope?: { type: 'company' | 'unit'; id: string },
): Promise<boolean> {
  try {
    const r = await pool.query<{ has_permission: boolean }>(
      'SELECT has_permission($1::uuid, $2::text, $3::text, $4::uuid) AS has_permission',
      [userId, permission, scope?.type ?? null, scope?.id ?? null],
    )
    return r.rows[0]?.has_permission === true
  } catch (err) {
    // DB indisponível → fail-closed (false) + log estruturado.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'has_permission_lookup_failed',
        userId: userId.slice(0, 8),
        permission,
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
    return false
  }
}

/**
 * Gate de Server Action: lança ApiException FORBIDDEN se user não tem
 * permission. Mensagem genérica (sem vazar quais permissions o user tem).
 */
export async function requirePermission(
  userId: string,
  permission: string,
  scope?: { type: 'company' | 'unit'; id: string },
): Promise<void> {
  if (!(await hasPermission(userId, permission, scope))) {
    throw new ApiException({
      code: 'FORBIDDEN',
      message: `Sem permissão para esta ação (${permission}).`,
      request_id: '',
    })
  }
}

/**
 * Helper convenience: verifica múltiplas permissions em paralelo. Retorna
 * map de permission → boolean. Usado em UI pra montar menu/actions condicionais.
 */
export async function hasPermissions(
  userId: string,
  permissions: string[],
): Promise<Record<string, boolean>> {
  const results = await Promise.all(permissions.map((p) => hasPermission(userId, p)))
  return Object.fromEntries(permissions.map((p, i) => [p, results[i] ?? false]))
}
