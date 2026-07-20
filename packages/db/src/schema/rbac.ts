/**
 * RBAC com scope (Sprint 01a — antecipando parte do escopo do Sprint 01b/ADR 0005).
 *
 * Modelo:
 *   - `roles` — papéis canônicos do sistema (medico, fisio, nutri, ...) + custom por tenant
 *   - `permissions` — lookup global (member.read, invoice.write, ...)
 *   - `role_permissions` — N:N (qual role tem qual permissão)
 *   - `user_roles` — assigment de role pra user, com scope opcional (company_id/unit_id)
 *   - `user_permission_grants` — grants DIRETOS a um user (override pontual além das roles)
 *   - `user_mfa_recovery_codes` — backup codes one-time pra MFA recovery
 *
 * **Regra 43 — MFA obrigatório:** `roles.requires_mfa = true` força user com role
 * marcada a completar enrollment TOTP antes de operar. Roles canônicas com flag:
 * `medico`, `fisio`, `nutri`, `personal`, `enfermeiro`, `tenant_owner`, `dpo`,
 * `super_admin`.
 *
 * **Scope** em `user_roles` permite:
 *   - role global (scope_company_id=null, scope_unit_id=null) → vale pro tenant inteiro
 *   - role escopada (scope_company_id=X) → vale só pra company X (regra 25)
 *   - role escopada (scope_unit_id=Y) → vale só pra unit Y (recepção de unidade)
 *
 * Sprint 01a Faixa C cria o SCHEMA + helpers de session. Avaliação real de
 * permissão acontece em Server Actions via `userHasPermission()` (futuro
 * Sprint 01b adiciona consents + grants complexos).
 */
import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { authUser } from './better-auth'
import { companies, units, users } from './identity'

// ─── roles ────────────────────────────────────────────────────────────────
// Roles canônicas (system=true) são criadas no seed inicial e NÃO podem ser
// editadas pelo tenant. Roles customizadas (system=false) são por tenant.
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // `key` é estável (medico, fisio, recepcao) — UI usa pra i18n
    key: text('key').notNull(),
    label: text('label').notNull(), // display name pra UI (pode ser pt-BR; i18n via catálogo)
    description: text('description'),

    // Tenant-scoped (custom roles) ou global (system roles — tenant_id NULL)
    tenantId: uuid('tenant_id'), // NULL = system role

    // Regra 43 — MFA obrigatório
    requiresMfa: boolean('requires_mfa').notNull().default(false),

    // System roles não podem ser deletadas; custom podem
    system: boolean('system').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Key único: system roles tem tenant_id=NULL (unique global); custom tem unique (tenant_id, key)
    uniqueIndex('roles_system_key_uq')
      .on(t.key)
      .where(sql`${t.tenantId} IS NULL`),
    uniqueIndex('roles_tenant_key_uq').on(t.tenantId, t.key).where(sql`${t.tenantId} IS NOT NULL`),
    index('roles_tenant_id_idx').on(t.tenantId),
  ],
)

// ─── permissions ──────────────────────────────────────────────────────────
// Lookup global — sem tenant_id. Permission é catálogo fixo (medico.evolucao.sign,
// member.read, invoice.write etc.). Adicionar permission = migration nova.
export const permissions = pgTable(
  'permissions',
  {
    key: text('key').primaryKey(), // ex: 'member.read', 'invoice.cancel'
    label: text('label').notNull(),
    description: text('description'),
    category: text('category').notNull(), // 'identidade' | 'financeiro' | 'clinico' | ...
    // Permission "high-risk" exige MFA recente (gate via requireRecentMfa)
    // Lista canônica em packages/security/src/high-risk-actions.ts
    isHighRisk: boolean('is_high_risk').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('permissions_category_idx').on(t.category)],
)

// ─── role_permissions ────────────────────────────────────────────────────
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('role_permissions_role_perm_uq').on(t.roleId, t.permissionKey),
    index('role_permissions_role_id_idx').on(t.roleId),
  ],
)

// ─── user_roles ──────────────────────────────────────────────────────────
// Atribui role(s) pra um user; cada atribuição pode ter scope opcional.
// Sem scope = role global no tenant.
export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),

    // Scope opcional — NULL = role vale pro tenant inteiro
    scopeCompanyId: uuid('scope_company_id').references(() => companies.id, {
      onDelete: 'cascade',
    }),
    scopeUnitId: uuid('scope_unit_id').references(() => units.id, { onDelete: 'cascade' }),

    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id), // who granted
    expiresAt: timestamp('expires_at', { withTimezone: true }), // role temporária opcional
  },
  (t) => [
    // Permite mesma role com scopes diferentes; o ÚNICO é (user, role, scope_company, scope_unit)
    uniqueIndex('user_roles_uq').on(t.userId, t.roleId, t.scopeCompanyId, t.scopeUnitId),
    index('user_roles_tenant_user_idx').on(t.tenantId, t.userId),
    index('user_roles_user_idx').on(t.userId),
  ],
)

// ─── user_permission_grants ──────────────────────────────────────────────
// Grants diretos a user (sem ser via role). Usar com moderação — preferir
// criar role customizada ou ampliar permissions de uma role existente.
export const userPermissionGrants = pgTable(
  'user_permission_grants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
    scopeCompanyId: uuid('scope_company_id').references(() => companies.id, {
      onDelete: 'cascade',
    }),
    scopeUnitId: uuid('scope_unit_id').references(() => units.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // ADR 0019 — revogação manual (Sprint 01b adiciona em retro do D.1)
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    uniqueIndex('user_permission_grants_uq').on(
      t.userId,
      t.permissionKey,
      t.scopeCompanyId,
      t.scopeUnitId,
    ),
    index('user_permission_grants_tenant_user_idx').on(t.tenantId, t.userId),
  ],
)

// ─── user_mfa_recovery_codes ─────────────────────────────────────────────
// 10 codes one-time gerados ao habilitar MFA. Hash bcrypt — código nunca
// armazenado em claro. UI mostra os 10 plain UMA vez no enrollment;
// recuperação posterior não é possível (gerar novos).
//
// **Importante:** essa tabela é COMPLEMENTAR ao backup codes do BetterAuth
// twoFactor plugin (`auth_two_factor.backup_codes`). Aqui temos shape LogiFit
// (per-tenant audit trail) — Sprint 01a Faixa C usa só esta tabela.
export const userMfaRecoveryCodes = pgTable(
  'user_mfa_recovery_codes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // Referencia auth_user.id (BetterAuth user), não users.id (LogiFit operator)
    // — MFA é por identidade auth, não por tenant. Mesmo user multi-tenant
    // compartilha MFA enrollment.
    authUserId: text('auth_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(), // bcrypt do código
    usedAt: timestamp('used_at', { withTimezone: true }), // null = não usado
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_mfa_recovery_codes_user_idx').on(t.authUserId),
    uniqueIndex('user_mfa_recovery_codes_hash_uq').on(t.codeHash),
  ],
)

export type RoleRow = typeof roles.$inferSelect
export type PermissionRow = typeof permissions.$inferSelect
export type UserRoleRow = typeof userRoles.$inferSelect
export type UserPermissionGrantRow = typeof userPermissionGrants.$inferSelect
export type UserMfaRecoveryCodeRow = typeof userMfaRecoveryCodes.$inferSelect
