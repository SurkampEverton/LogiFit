/**
 * Certificado digital A1 + NF-e SEFAZ cursors — Sprint 17 Faixa A.
 *
 * **Criptografia** (ADR 0073 camada 4 + regra 38):
 *   - `encrypted_pfx bytea` — arquivo .pfx cifrado AES-256-GCM
 *   - `encrypted_password text` — senha do .pfx cifrada (defesa em profundidade — chave separada)
 *   - KEK por company; master key LogiFit em env (rotação semestral)
 *   - `scanUpload()` (regra 38) valida magic bytes do .pfx antes de cifrar
 *
 * **Validade A1:** geralmente 1 ano. Alerta `certificate.expiring_soon` 30 dias antes
 * (cross-alert dispatcher Sprint 07).
 *
 * **nfe_sefaz_cursors:** estado da sincronização SEFAZ por (company, provider).
 * `last_nsu` = Número Sequencial Único do SEFAZ (resume incremental).
 */
import { sql } from 'drizzle-orm'
import {
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { companies, users } from './identity'

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea'
  },
})

// ─── Enums ───────────────────────────────────────────────────────────────

export const certificateStatusEnum = pgEnum('certificate_status', [
  'active',
  'expired',
  'revoked',
  'replaced', // substituído por outro
])

export const nfeProviderEnum = pgEnum('nfe_recepcao_provider', [
  'arquivei',
  'sieg',
  'focus',
  'sefaz_direct', // direto SEFAZ via cert A1
])

// ─── company_certificates ───────────────────────────────────────────────

export const companyCertificates = pgTable(
  'company_certificates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull().default('a1'), // futuro: a3
    /** Subject CN extraído do cert pra display */
    subjectCn: text('subject_cn'),
    /** CNPJ extraído pra validação (match com company.person.document) */
    subjectCnpj: text('subject_cnpj'),
    issuer: text('issuer'),
    serialNumber: text('serial_number'),
    /** PFX cifrado AES-256-GCM */
    encryptedPfx: bytea('encrypted_pfx').notNull(),
    /** Senha cifrada (chave separada da pfx — defesa em profundidade) */
    encryptedPassword: text('encrypted_password').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: certificateStatusEnum('status').notNull().default('active'),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('cert_company_active_idx').on(t.companyId).where(sql`status = 'active'`),
    index('cert_expiring_soon_idx').on(t.expiresAt).where(sql`status = 'active'`),
  ],
)

// ─── nfe_sefaz_cursors ──────────────────────────────────────────────────

export const nfeSefazCursors = pgTable(
  'nfe_sefaz_cursors',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    provider: nfeProviderEnum('provider').notNull(),
    /** Resume incremental do SEFAZ — string opaca do provider */
    lastNsu: text('last_nsu'),
    /** Última corrida do job — null = nunca rodou */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncCount: integer('last_sync_count').notNull().default(0),
    lastSyncError: text('last_sync_error'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('nfe_cursors_company_provider_uq').on(t.companyId, t.provider)],
)
