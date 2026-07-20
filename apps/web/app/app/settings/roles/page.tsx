import { db } from '@repo/db/client'
import { permissions, rolePermissions, roles } from '@repo/db/schema'
/**
 * `/app/settings/roles` — listagem de roles + permissions (Sprint 01b custom roles UI).
 *
 * MVP: read-only listagem. Sprint 02+ adiciona form pra criar role custom +
 * editar role_permissions (drag&drop ou checkboxes).
 *
 * Schema: roles + permissions + role_permissions (Sprint 01a Faixa C).
 */
import { asc, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function RolesPage() {
  await requireFullSession('/app/settings/roles')

  // System roles (tenant_id IS NULL) — custom roles do tenant entram Sprint 02+
  const allRoles = await db
    .select({
      id: roles.id,
      key: roles.key,
      label: roles.label,
      description: roles.description,
      requiresMfa: roles.requiresMfa,
      tenantId: roles.tenantId,
    })
    .from(roles)
    .where(isNull(roles.tenantId))
    .orderBy(asc(roles.key))

  // Conta permissions por role via subquery
  const counts = await db
    .select({
      roleId: rolePermissions.roleId,
      permissionKey: rolePermissions.permissionKey,
    })
    .from(rolePermissions)

  const countByRole = new Map<string, number>()
  for (const c of counts) {
    countByRole.set(c.roleId, (countByRole.get(c.roleId) ?? 0) + 1)
  }

  // Lista todas as permissions agrupadas por category
  const perms = await db
    .select()
    .from(permissions)
    .orderBy(asc(permissions.category), asc(permissions.key))

  const permsByCategory = new Map<string, typeof perms>()
  for (const p of perms) {
    const cat = p.category ?? 'outras'
    if (!permsByCategory.has(cat)) permsByCategory.set(cat, [])
    permsByCategory.get(cat)?.push(p)
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link
          href="/app/settings/users"
          className="text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar para Usuários
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Roles e permissões</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Roles do sistema LogiFit + custom roles por tenant (Sprint 01b ADR 0019). Editor de
          role_permissions completo em Sprint 02+.
        </p>
      </header>

      <section className="rounded-xl border border-[color:var(--ev-border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--ev-surface-muted)] text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium">Permissions</th>
              <th className="px-4 py-3 font-medium">MFA</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
            </tr>
          </thead>
          <tbody>
            {allRoles.map((r) => (
              <tr key={r.id} className="border-t border-[color:var(--ev-border)]">
                <td className="px-4 py-3 font-mono font-medium">{r.key}</td>
                <td className="px-4 py-3 text-[color:var(--ev-text-muted)]">
                  {r.description ?? '—'}
                </td>
                <td className="px-4 py-3 tabular-nums">{countByRole.get(r.id) ?? 0}</td>
                <td className="px-4 py-3">
                  {r.requiresMfa ? (
                    <span className="text-xs text-[color:var(--ev-warning, #f59e0b)]">
                      ⚠ obrigatório
                    </span>
                  ) : (
                    <span className="text-xs text-[color:var(--ev-text-muted)]">opcional</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[color:var(--ev-text-muted)]">
                    {r.tenantId === null ? 'system' : 'custom'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
        <h2 className="font-semibold">📋 Catálogo de permissions ({perms.length})</h2>
        <p className="text-xs text-[color:var(--ev-text-muted)]">
          Agrupadas por categoria. Permissions com `is_high_risk=true` exigem MFA recente para
          aplicar (regra 43 + ADR 0073).
        </p>
        <div className="space-y-3">
          {Array.from(permsByCategory.entries()).map(([cat, list]) => (
            <details key={cat} className="rounded-md border border-[color:var(--ev-border)] p-3">
              <summary className="cursor-pointer font-medium capitalize">
                {cat} ({list.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {list.map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-3 py-1">
                    <span className="font-mono">{p.key}</span>
                    <span className="text-[color:var(--ev-text-muted)] truncate">{p.label}</span>
                    {p.isHighRisk && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ backgroundColor: 'var(--ev-warning, #f59e0b)', color: 'white' }}
                      >
                        HIGH RISK
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
        <p>
          <strong>Sprint 02+</strong>: editor visual de role_permissions (checkboxes por categoria)
          + form pra criar custom role per-tenant + interface para revogar/conceder permissions
          individuais via `user_permission_grants` (ADR 0019).
        </p>
      </section>
    </div>
  )
}
