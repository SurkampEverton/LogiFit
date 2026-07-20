/**
 * Hierarquia organizacional canônica LogiFit (ADR 0006-0009).
 *
 *   group (opcional, agregado sem CNPJ)
 *    └── tenant (contrato SaaS — RLS raiz)
 *         └── company (matriz/filial — CNPJ via persons kind=pj)
 *              └── unit (local físico — sem person)
 *
 *   users (operadores) ↔ tenants (N:N via user_tenants)
 *
 * `persons` é cadastro central (ADR 0047): companies tem `person_id` FK
 * pra persons kind=pj; users tem `person_id` FK pra persons kind=pf.
 *
 * Regras de schema enforced via constraints SQL:
 *   - 1 matriz por tenant (índice parcial UNIQUE WHERE type='matriz')
 *   - companies.person_id refere persons kind=pj (CHECK via trigger)
 *   - users.person_id refere persons kind=pf (CHECK via trigger)
 *   - `tenants.mode` enum vem no Sprint 01b (ADR 0069 — modo solo)
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { persons } from './persons'

// ─── Enums ─────────────────────────────────────────────────────────────────
export const topologyEnum = pgEnum('tenant_topology', ['owned', 'franchise'])
export const financialModeEnum = pgEnum('tenant_financial_mode', ['centralized', 'distributed'])
export const subscriptionStatusEnum = pgEnum('tenant_subscription_status', [
  'trialing',
  'active',
  'trial_expired',
  'suspended',
  'anonymized',
])
export const companyTypeEnum = pgEnum('company_type', ['matriz', 'filial'])
// Sprint 01b — ADR 0069 Plano Solo
export const tenantModeEnum = pgEnum('tenant_mode', ['multi', 'solo'])

// ─── groups ────────────────────────────────────────────────────────────────
/**
 * Camada agregada organizacional (sem CNPJ, sem RLS) — ADR 0008.
 * Só dashboard consolidado via views. NUNCA filtro de query operacional.
 */
export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── tenants ───────────────────────────────────────────────────────────────
/**
 * Contrato SaaS — RLS raiz (regra 1).
 *
 * `mode` ('multi' vs 'solo' — ADR 0069) será adicionado no Sprint 01b
 * junto com Plano Solo + wizard de onboarding diferenciado.
 *
 * `shard_url` (ADR 0072) — preparação pra sharding futuro; NULL = cluster
 * compartilhado. Sprint 01a só declara coluna; rota de connection real é
 * pós-MVP quando 1º tenant pedir cluster dedicado.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    groupId: uuid('group_id').references(() => groups.id),

    name: text('name').notNull(),
    slug: text('slug').notNull(), // subdomain — ADR 0065

    topology: topologyEnum('topology').notNull().default('owned'),
    financialMode: financialModeEnum('financial_mode').notNull().default('centralized'),
    crossCompanyAccess: boolean('cross_company_access').notNull().default(false),
    // Sprint 01b — ADR 0069: 'solo' = profissional autônomo (1 matriz, 0 filiais)
    // CHECK constraint via policy: solo NÃO PODE ter crossCompanyAccess=true
    mode: tenantModeEnum('mode').notNull().default('multi'),

    // Trial + lifecycle (ADR 0066)
    subscriptionStatus: subscriptionStatusEnum('subscription_status').notNull().default('trialing'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),

    // Sharding preparado (ADR 0072) — não usado no MVP
    shardUrl: text('shard_url'),

    // Locale default do tenant (ADR 0052 — i18n 3 idiomas)
    defaultLocale: text('default_locale').notNull().default('pt-BR'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tenants_slug_uq').on(t.slug), index('tenants_group_id_idx').on(t.groupId)],
)

// ─── companies ─────────────────────────────────────────────────────────────
/**
 * Pessoa jurídica registrada (matriz/filial) — 1 matriz por tenant obrigatória
 * (regra 21 + ADR 0009). Filial tem `parent_company_id` apontando pra matriz.
 *
 * `person_id` aponta pra persons kind=pj — CNPJ vive em persons.document.
 * Unicidade global de CNPJ vem da unicidade por tenant em persons + lookup
 * cross-tenant em Server Actions (regra 22 não pode ser SQL puro: CNPJ pode
 * existir em N tenants legitimamente — passaporte cross-tenant ADR 0077 não
 * é o caso aqui; só queremos evitar duplicação INTRA tenant via persons UQ).
 */
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),

    type: companyTypeEnum('type').notNull(),
    parentCompanyId: uuid('parent_company_id'),

    // Dados fiscais (regra 23 + ADR 0006)
    ie: text('ie'), // Inscrição Estadual
    im: text('im'), // Inscrição Municipal
    regimeTributario: text('regime_tributario'), // 'simples' | 'presumido' | 'real' | 'mei'

    // CNES (Cadastro Nacional de Estabelecimentos de Saúde — Fase 2 fisio/nutri)
    cnesCode: text('cnes_code'),

    /**
     * Documentos que a empresa emite — espelham as habilitações do cadastro
     * Focus. Default conservador: só NFS-e, que é o caso de uso central;
     * NF-e/NFC-e só em quem vende produto.
     */
    habilitaNfse: boolean('habilita_nfse').notNull().default(true),
    habilitaNfe: boolean('habilita_nfe').notNull().default(false),
    habilitaNfce: boolean('habilita_nfce').notNull().default(false),

    /** Id desta company no cadastro da conta Focus NFe do tenant (ADR 0105) */
    focusEmpresaId: text('focus_empresa_id'),
    /**
     * Quando login/senha do portal municipal foram enviados à Focus.
     * As credenciais **não** são armazenadas — repassadas e descartadas.
     */
    municipalCredentialsConfiguredAt: timestamp('municipal_credentials_configured_at', {
      withTimezone: true,
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 1 matriz por tenant — unique index parcial
    uniqueIndex('companies_matriz_per_tenant_uq')
      .on(t.tenantId)
      .where(sql`${t.type} = 'matriz'`),
    // person_id é único entre companies do mesmo tenant (1 CNPJ → 1 company)
    uniqueIndex('companies_person_per_tenant_uq').on(t.tenantId, t.personId),
    index('companies_tenant_id_idx').on(t.tenantId),
    index('companies_parent_id_idx').on(t.parentCompanyId),
  ],
)

// ─── units ─────────────────────────────────────────────────────────────────
/**
 * Local físico (endereço operacional) — sem person, sem CNPJ próprio.
 * `units` herdam o CNPJ da `company` pai pra fins fiscais.
 */
export const units = pgTable(
  'units',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    name: text('name').notNull(),
    address: jsonb('address').notNull(),

    capacity: numeric('capacity'), // capacidade física (ex: alunos simultâneos)
    areaM2: numeric('area_m2'), // m² do espaço

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('units_tenant_id_idx').on(t.tenantId),
    index('units_company_id_idx').on(t.companyId),
  ],
)

// ─── users ─────────────────────────────────────────────────────────────────
/**
 * Operadores do sistema (não confundir com `members` = aluno/paciente).
 *
 * `auth_user_id` aponta pro user do provider de auth (BetterAuth/Lucia
 * — Sprint 01a Faixa B decide); NÃO aponta pra Supabase. Cookie httpOnly
 * próprio carrega `user_id` + `tenant_id` claims.
 *
 * MFA é obrigatório pra roles profissionais (regra 43). Coluna `mfa_enabled`
 * registra estado; lookup de "tem TOTP secret" vive em `user_mfa_factors`
 * (tabela separada criada na Faixa B — segregar secrets).
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),

    // FK opaca pro provider de auth (BetterAuth/Lucia/etc). NULL se ainda
    // não ativou conta (convite pendente).
    authUserId: uuid('auth_user_id'),

    username: text('username').notNull(),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_tenant_username_uq').on(t.tenantId, t.username),
    uniqueIndex('users_tenant_person_uq').on(t.tenantId, t.personId),
    index('users_auth_user_id_idx').on(t.authUserId),
  ],
)

// ─── user_tenants ──────────────────────────────────────────────────────────
/**
 * N:N user × tenant — operador acessa múltiplos tenants (ex.: consultor que
 * atende várias academias). MESMA PESSOA = persons distinto por tenant
 * (cadastro central isola por RLS); pode compartilhar `auth_user_id`.
 *
 * RLS aqui é especial — leitura permitida quando JWT user_id casa, mesmo
 * que tenant_id da policy raiz não case. Policy específica em `/policies/`.
 */
export const userTenants = pgTable(
  'user_tenants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_tenants_user_tenant_uq').on(t.userId, t.tenantId),
    index('user_tenants_user_id_idx').on(t.userId),
    index('user_tenants_tenant_id_idx').on(t.tenantId),
  ],
)

// ─── Type exports ──────────────────────────────────────────────────────────
export type GroupRow = typeof groups.$inferSelect
export type GroupInsert = typeof groups.$inferInsert
export type TenantRow = typeof tenants.$inferSelect
export type TenantInsert = typeof tenants.$inferInsert
export type CompanyRow = typeof companies.$inferSelect
export type CompanyInsert = typeof companies.$inferInsert
export type UnitRow = typeof units.$inferSelect
export type UnitInsert = typeof units.$inferInsert
export type UserRow = typeof users.$inferSelect
export type UserInsert = typeof users.$inferInsert
export type UserTenantRow = typeof userTenants.$inferSelect
export type UserTenantInsert = typeof userTenants.$inferInsert
