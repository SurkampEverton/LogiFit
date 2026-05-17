/**
 * Prontuário eletrônico Fisio + CID-11 + CIF — Sprint 20 Faixa A (ADR 0028 + ADR 0032 Accepted).
 *
 * 7 tabelas:
 *   - cid_catalog — CID-11 global versionado (tenant_id NULL = leitura por todos)
 *   - cif_catalog — CIF global (4 componentes: body_functions/structures/activities/environmental)
 *   - signature_policies — política de assinatura por profissão (ADR 0032)
 *   - tenant_signature_overrides — endurecimento per tenant (Enterprise; só permite escalar)
 *   - consultas — prontuário polimórfico (kind: medico/fisio/nutri/personal/custom)
 *   - consulta_cids — M:N consulta↔CID com kind (principal/secundario)
 *   - consulta_cifs — M:N consulta↔CIF com qualifier 0-4
 *   - consulta_correction_notes — append-only notas corretivas pós-lock
 *
 * **Lei 13.787/2018** — retenção mínima 20 anos para prontuário eletrônico.
 * **CFM 2.299/2021** — assinatura ICP-Brasil obrigatória pra médicos.
 * **COFFITO 414/2012 + 415/2012** — ICP-Brasil OPCIONAL pra fisio se houver
 *   sistema autenticado + audit chain (regra 39).
 * **CFN 599/2018** — análogo a COFFITO para nutricionistas.
 *
 * **Particionamento `consultas`** (regra 34 + ADR 0072):
 *   - 1k tenants × 500 consultas/mês × 12 = 6M+ linhas/ano
 *   - PARTITION BY RANGE (created_at) trimestral via migration manual
 *   - 5 anos hot + 15 anos cold storage Parquet zstd (retenção 20 anos)
 *
 * **Audit em LEITURA** (regra 5 + 39):
 *   - Toda SELECT em consulta `status='signed'` grava `audit_log` action='consulta.read'
 *   - Hash chain garante integridade temporal
 *
 * **Regra 25 (franchise):** consulta clínica NÃO atravessa company_id em
 *   topology=franchise. RLS enforce via comparação com session company_id.
 *
 * @volume_estimate_yearly: 6000000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { appointments } from './agenda'
import { companies, users } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const consultaKindEnum = pgEnum('consulta_kind', [
  'medico',
  'fisio',
  'nutri',
  'personal',
  'enfermeiro',
  'custom',
])

export const consultaStatusEnum = pgEnum('consulta_status', [
  'draft', // em edição
  'locked', // fechado mas sem assinatura ICP (authenticated_lock)
  'signed', // assinado com ICP-Brasil
  'archived', // 20 anos passaram OU movido pra cold storage
])

export const signatureModeEnum = pgEnum('signature_mode', [
  'icp_required', // CFM 2.299/2021 — médico
  'icp_optional', // COFFITO 414/2012 — fisio aceita ICP ou lacre
  'authenticated_lock', // CFN 599/2018 / COFFITO 414/2012 — lacre autenticado sem ICP
])

export const lockMethodEnum = pgEnum('lock_method', [
  'icp_brasil_a1', // .pfx em HSM
  'icp_brasil_a3', // token criptográfico
  'authenticated_mfa', // sessão autenticada + MFA recente <15min
])

export const cidLinkKindEnum = pgEnum('cid_link_kind', [
  'principal', // CID principal da consulta (obrigatório ≥1)
  'secundario', // comorbidades / diagnósticos secundários
])

export const cifComponentEnum = pgEnum('cif_component', [
  'body_functions', // funções do corpo (b)
  'body_structures', // estruturas do corpo (s)
  'activities_participation', // atividades e participação (d)
  'environmental_factors', // fatores ambientais (e)
])

// ─── cid_catalog (global) ───────────────────────────────────────────────
/**
 * CID-11 (Classificação Internacional de Doenças, 11ª revisão).
 * Globalmente curado pela LogiFit; tenant lê, nunca edita.
 * Update anual via migration de release.
 */
export const cidCatalog = pgTable(
  'cid_catalog',
  {
    code: text('code').primaryKey(), // ex: 'MG30.0' (dor lombar)
    description: text('description').notNull(),
    chapter: text('chapter'), // ex: 'MG' (Sintomas musculoesqueléticos)
    version: text('version').notNull().default('CID-11'), // 'CID-11' | 'CID-10' (legado)
    active: boolean('active').notNull().default(true),
    releaseDate: text('release_date'), // YYYY-MM-DD versão WHO
  },
  (t) => [
    index('cid_chapter_idx').on(t.chapter),
    index('cid_active_idx').on(t.active).where(sql`active = true`),
  ],
)

// ─── cif_catalog (global) ───────────────────────────────────────────────
/**
 * CIF (Classificação Internacional de Funcionalidade). Cada code tem um
 * `component` (b/s/d/e). Qualifier 0-4 vai em `consulta_cifs.qualifier`.
 */
export const cifCatalog = pgTable(
  'cif_catalog',
  {
    code: text('code').primaryKey(), // ex: 'b280' (dor)
    description: text('description').notNull(),
    component: cifComponentEnum('component').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    index('cif_component_idx').on(t.component),
    index('cif_active_idx').on(t.active).where(sql`active = true`),
  ],
)

// ─── signature_policies (catálogo global ADR 0032) ─────────────────────

export const signaturePolicies = pgTable(
  'signature_policies',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    profession: text('profession').notNull().unique(), // 'medico' | 'fisio' | 'nutri' | 'personal' | 'enfermeiro'
    mode: signatureModeEnum('mode').notNull(),
    /** 'A1' | 'A3' | NULL — só aplica quando mode contém ICP */
    minCertLevel: text('min_cert_level'),
    requiresMfa: boolean('requires_mfa').notNull().default(true),
    requiresAuditChain: boolean('requires_audit_chain').notNull().default(true),
    requiresAuthenticatedSession: boolean('requires_authenticated_session').notNull().default(true),
    sourceNorm: text('source_norm').notNull(), // 'CFM 2.299/2021' etc
    retentionYears: integer('retention_years').notNull().default(20), // Lei 13.787/2018
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
)

// ─── tenant_signature_overrides (endurecer per tenant) ─────────────────

export const tenantSignatureOverrides = pgTable(
  'tenant_signature_overrides',
  {
    tenantId: uuid('tenant_id').notNull(),
    profession: text('profession').notNull(),
    /** Só aceita 'icp_required' acima do baseline (CHECK enforce). */
    modeOverride: signatureModeEnum('mode_override').notNull(),
    reason: text('reason').notNull(),
    approvedByUserId: uuid('approved_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.profession] }),
    check('tsoverride_only_harden', sql`mode_override = 'icp_required'`),
  ],
)

// ─── consultas (prontuário polimórfico) ────────────────────────────────

export const consultas = pgTable(
  'consultas',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    professionalUserId: uuid('professional_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: consultaKindEnum('kind').notNull(),
    /** FK opcional para `assessment_types` quando usa template estruturado */
    templateTypeId: uuid('template_type_id'),
    /** SOAP / texto livre / fields conforme template */
    content: jsonb('content').notNull().default(sql`'{}'::jsonb`),
    status: consultaStatusEnum('status').notNull().default('draft'),
    /** Resolvido por kind na criação; cacheado pra evitar lookup repetido. */
    signatureMode: signatureModeEnum('signature_mode').notNull(),
    /** ICP-Brasil only — quando o user assinou com cert válido. */
    signedAt: timestamp('signed_at', { withTimezone: true }),
    /** sha256 do conteúdo no momento do lock (regra 39 base hash). */
    signedHash: text('signed_hash'),
    /** Provider ICP usado (cert-sign / bry / vaultsign / null) */
    signatureProvider: text('signature_provider'),
    lockMethod: lockMethodEnum('lock_method'),
    lockedByUserId: uuid('locked_by_user_id').references(() => users.id),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    /** Snapshot do council_body + council_state + council_number do profissional
     *  no momento da assinatura — exigido por CFM 2.299/2021 art. 3º. */
    councilSnapshot: jsonb('council_snapshot'),
    /** Conselho ID original lookup para auditoria (council_body único do gate) */
    councilBodyAtSign: text('council_body_at_sign'),
    /** Ciclo de vida */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Para arquivamento cold storage (retenção 20a) — quando movido pro Parquet */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('consultas_tenant_member_idx').on(t.tenantId, t.memberId, t.createdAt),
    index('consultas_tenant_status_idx').on(t.tenantId, t.status),
    index('consultas_tenant_kind_idx').on(t.tenantId, t.kind),
    index('consultas_professional_idx').on(t.professionalUserId, t.createdAt),
    check(
      'consultas_signed_consistent',
      sql`(status != 'signed' OR (signed_at IS NOT NULL AND signed_hash IS NOT NULL))`,
    ),
    check(
      'consultas_locked_consistent',
      sql`(status NOT IN ('locked', 'signed') OR locked_at IS NOT NULL)`,
    ),
  ],
)

// ─── consulta_cids (M:N) ───────────────────────────────────────────────

export const consultaCids = pgTable(
  'consulta_cids',
  {
    consultaId: uuid('consulta_id')
      .notNull()
      .references(() => consultas.id, { onDelete: 'cascade' }),
    cidCode: text('cid_code')
      .notNull()
      .references(() => cidCatalog.code, { onDelete: 'restrict' }),
    kind: cidLinkKindEnum('kind').notNull().default('principal'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.consultaId, t.cidCode, t.kind] }),
    index('consulta_cids_consulta_idx').on(t.consultaId),
    index('consulta_cids_code_idx').on(t.cidCode),
  ],
)

// ─── consulta_cifs (M:N) ───────────────────────────────────────────────

export const consultaCifs = pgTable(
  'consulta_cifs',
  {
    consultaId: uuid('consulta_id')
      .notNull()
      .references(() => consultas.id, { onDelete: 'cascade' }),
    cifCode: text('cif_code')
      .notNull()
      .references(() => cifCatalog.code, { onDelete: 'restrict' }),
    /** Qualifier CIF: 0=sem problema, 1=leve, 2=moderado, 3=grave, 4=completo */
    qualifier: integer('qualifier').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.consultaId, t.cifCode] }),
    check('consulta_cifs_qualifier_range', sql`qualifier >= 0 AND qualifier <= 4`),
  ],
)

// ─── consulta_correction_notes (append-only) ────────────────────────────

export const consultaCorrectionNotes = pgTable(
  'consulta_correction_notes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    consultaId: uuid('consulta_id')
      .notNull()
      .references(() => consultas.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    reason: text('reason').notNull(),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Hash do corpo da nota pra incluir em audit chain (regra 39) */
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('correction_consulta_idx').on(t.consultaId, t.createdAt),
    index('correction_tenant_idx').on(t.tenantId, t.createdAt),
  ],
)

// Suppress unused warnings de cláusulas que retornam tipo (drizzle)
void bigint
void uniqueIndex
