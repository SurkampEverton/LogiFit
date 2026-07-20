/**
 * Evolução por sessão Fisio + anexos categorizados — Sprint 21 Faixa A.
 *
 * 2 tabelas:
 *   - evolucoes_sessao — registro SOAP por appointment (Sprint 03)
 *   - evolucao_attachments — anexos categorizados (exame imagem / vídeo execução / documento / foto postural)
 *
 * **Diferença vs `consultas` (Sprint 20):**
 *   - `consultas` = avaliação inicial / reavaliação periódica (formal, com CID/CIF + signature_policies)
 *   - `evolucoes_sessao` = registro de sessão de tratamento (rápido, mobile-friendly, SOAP enxuto)
 *   - Decisão tomada no Sprint 21 doc: entidade separada por modelo mental + frequência diferentes.
 *
 * **Lei 13.787/2018** retenção 20 anos (mesma de consultas).
 * **COFFITO 415/2012 art. 11** retenção 5 anos mínimo da evolução clínica
 * (LogiFit usa o maior dos 2 — 20 anos como `consultas`).
 *
 * **Particionamento `evolucoes_sessao`** (regra 34 + ADR 0072):
 *   - 1k tenants × 1k pacientes × 1 sessão/semana × 52 = 52M+ linhas/ano (top 5 volume)
 *   - PARTITION BY RANGE (created_at) trimestral via migration manual
 *   - 5 anos hot + 15 anos cold storage Parquet zstd
 *
 * **Anexos** em `evolucao_attachments` carregam apenas metadata (storage_path);
 * binário fica em MinIO bucket `fisio-evolucoes` (já definido em `@repo/storage/buckets.ts`).
 *
 * **scanUpload obrigatório (regra 38):** API Route upload chama `scanUpload()`
 * de `@repo/security/scan-upload.ts` antes de gravar `evolucao_attachments`.
 * `scan_status` enum acompanha estado (pending → clean → published; ou rejected).
 *
 * **URL assinada TTL 10min** — `presignGet` do storage adapter; nunca expor
 * `storage_path` direto ao cliente.
 *
 * @volume_estimate_yearly: 52000000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { appointments } from './agenda'
import { companies, users } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const evolucaoAttachmentKindEnum = pgEnum('evolucao_attachment_kind', [
  'exame_imagem', // raio-X, RM, US, TC
  'video_execucao', // vídeo do paciente executando exercício
  'documento', // laudo, receita, encaminhamento
  'foto_postural', // foto frontal/lateral/posterior pra análise postural
  'audio_anamnese', // áudio gravado durante atendimento (stretch Sprint 21+)
])

export const evolucaoAttachmentScanStatusEnum = pgEnum('evolucao_attachment_scan_status', [
  'pending', // upload recebido, scan em fila
  'clean', // scan passou, arquivo disponível
  'rejected', // scan reprovou (vírus/embed proibido/MIME mismatch)
  'soft_deleted', // operador deletou; metadata retém pra audit
])

export const evolucaoStatusEnum = pgEnum('evolucao_status', [
  'draft', // editável
  'locked', // fechado autenticado (mesmo lacre fisio)
  'signed', // assinado ICP-Brasil (opcional)
])

// ─── evolucoes_sessao ───────────────────────────────────────────────────

export const evolucoesSessao = pgTable(
  'evolucoes_sessao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** Cada appointment vira no máximo 1 evolução (unique abaixo) */
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    professionalUserId: uuid('professional_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** SOAP: { subjetivo, objetivo, avaliacao, plano } — chaves opcionais individualmente */
    soap: jsonb('soap').notNull().default(sql`'{}'::jsonb`),
    /** Campo livre adicional pra anotações fora do SOAP */
    freeText: text('free_text'),
    status: evolucaoStatusEnum('status').notNull().default('draft'),
    /** Quando assinada/lacrada — null em draft */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedByUserId: uuid('locked_by_user_id').references(() => users.id),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    /** sha256 do soap+freeText+attachmentIds (regra 39) */
    signedHash: text('signed_hash'),
    signatureProvider: text('signature_provider'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Para arquivamento cold storage 20a */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('evol_tenant_member_idx').on(t.tenantId, t.memberId, t.createdAt),
    index('evol_tenant_prof_idx').on(t.professionalUserId, t.createdAt),
    uniqueIndex('evol_appointment_uq').on(t.appointmentId).where(sql`appointment_id IS NOT NULL`),
    check(
      'evol_signed_consistent',
      sql`(status != 'signed' OR (signed_at IS NOT NULL AND signed_hash IS NOT NULL))`,
    ),
    check(
      'evol_locked_consistent',
      sql`(status NOT IN ('locked','signed') OR locked_at IS NOT NULL)`,
    ),
  ],
)

// ─── evolucao_attachments ───────────────────────────────────────────────

export const evolucaoAttachments = pgTable(
  'evolucao_attachments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    evolucaoId: uuid('evolucao_id')
      .notNull()
      .references(() => evolucoesSessao.id, { onDelete: 'restrict' }),
    kind: evolucaoAttachmentKindEnum('kind').notNull(),
    /** Chave no bucket (tenant_key — ver @repo/storage/tenant-key.ts) */
    storagePath: text('storage_path').notNull(),
    /** Bucket lógico (BUCKETS.FISIO_EVOLUCOES default; futuro pode usar bucket especializado por kind) */
    storageBucket: text('storage_bucket').notNull().default('fisio-evolucoes'),
    filename: text('filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mimeType: text('mime_type').notNull(),
    /** sha256 do conteúdo pra dedup + audit (calculado no upload) */
    contentHash: text('content_hash'),
    /** Estado do scan antivírus (regra 38) — só `clean` é exibido ao cliente */
    scanStatus: evolucaoAttachmentScanStatusEnum('scan_status').notNull().default('pending'),
    scanReason: text('scan_reason'),
    /** Caption opcional sobre o anexo */
    caption: text('caption'),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft-delete preserva metadata pra audit + retenção; arquivo físico pode ser removido do storage */
    softDeletedAt: timestamp('soft_deleted_at', { withTimezone: true }),
    softDeletedByUserId: uuid('soft_deleted_by_user_id').references(() => users.id),
    softDeleteReason: text('soft_delete_reason'),
  },
  (t) => [
    index('evol_att_evolucao_idx').on(t.evolucaoId).where(sql`soft_deleted_at IS NULL`),
    index('evol_att_tenant_idx').on(t.tenantId, t.uploadedAt),
    index('evol_att_scan_pending_idx').on(t.scanStatus).where(sql`scan_status = 'pending'`),
    check('evol_att_size_positive', sql`size_bytes > 0 AND size_bytes <= 52428800`), // 50MB max
  ],
)

// Suppress unused
void boolean
