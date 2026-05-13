/**
 * RAG + cache semântico + insights cross-module — Sprint 06 Faixa B (ADR 0064).
 *
 * 4 tabelas:
 *   - `ai_documents` — docs ingeridos (ADRs/sprints/regulações/uploads tenant)
 *   - `ai_document_chunks` — chunks ~500 tokens com embedding pgvector (768d)
 *   - `ai_semantic_cache` — cache de respostas LLM por similaridade de embedding
 *   - `member_insights` — cache cross-module 6-24h TTL (ADR 0070 esperado)
 *
 * `ai_documents`/`ai_document_chunks` são GLOBAIS quando `tenant_id IS NULL`
 * (seed LogiFit: ADRs/sprints/regulações) e TENANT-SCOPED quando preenchido
 * (uploads tenant em /app/settings/ia/knowledge). Search híbrido faz UNION:
 * sempre global + tenant atual (RLS via WHERE).
 *
 * `ai_semantic_cache` é por tenant. Sprint 06+ pode estender pra cache global
 * de respostas Camada 1 (RAG-only) que não dependem de dado tenant.
 *
 * **pgvector** já habilitado no Sprint 00 (cache de embeddings + Sprint 02
 * busca semântica de members). HNSW index em `embedding` cobre similaridade.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// pgvector — Drizzle não tem tipo nativo; custom type estável.
const vector768 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(768)'
  },
  toDriver(value) {
    return `[${value.join(',')}]`
  },
  fromDriver(value) {
    if (typeof value !== 'string') return []
    return value.replace(/[[\]]/g, '').split(',').map(Number)
  },
})

export const aiDocSourceEnum = pgEnum('ai_doc_source', [
  'adr', // docs/decisions/*.md
  'sprint', // docs/sprints/*.md
  'regulation', // CFM 2.454, LGPD, TISS 4.01, etc (curado)
  'schema', // tabelas Drizzle + comentários
  'runbook', // docs/runbooks/*.md
  'user_uploaded', // tenant subiu via /app/settings/ia/knowledge
])

// ─── ai_documents ────────────────────────────────────────────────────────
/**
 * `tenant_id IS NULL` = global (seed LogiFit). Preenchido = upload tenant.
 * `hash_sha256` detecta mudança no conteúdo → reseed do chunks.
 */
export const aiDocuments = pgTable(
  'ai_documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id'), // null = global
    source: aiDocSourceEnum('source').notNull(),
    sourcePath: text('source_path').notNull(), // 'docs/decisions/0064-...md'
    title: text('title').notNull(),
    contentHash: text('content_hash').notNull(), // sha256(content) — detecta change
    tokensTotal: integer('tokens_total').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_documents_source_path_uq').on(t.sourcePath, t.tenantId),
    index('ai_documents_tenant_source_idx').on(t.tenantId, t.source),
  ],
)

// ─── ai_document_chunks ──────────────────────────────────────────────────
/**
 * ~500 tokens, overlap 50. Embedding gerado por `text-embedding-004` (768d).
 * HNSW index pra busca por similaridade (`<=>` cosine).
 */
export const aiDocumentChunks = pgTable(
  'ai_document_chunks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id'), // null = global (herda do parent document)
    documentId: uuid('document_id')
      .notNull()
      .references(() => aiDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokens: integer('tokens').notNull(),
    embedding: vector768('embedding'), // null antes do embed job rodar
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_document_chunks_doc_idx_uq').on(t.documentId, t.chunkIndex),
    index('ai_document_chunks_tenant_idx').on(t.tenantId),
    // HNSW index criado via migration raw em packages/db/src/policies/0026_ai_rag.sql
  ],
)

// ─── ai_semantic_cache ───────────────────────────────────────────────────
/**
 * Pergunta com similarity >0.93 retorna resposta cached.
 * TTL 30 dias; LRU eviction quando >100k rows por tenant (cron job).
 */
export const aiSemanticCache = pgTable(
  'ai_semantic_cache',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    queryText: text('query_text').notNull(),
    queryEmbedding: vector768('query_embedding').notNull(),
    responseText: text('response_text').notNull(),
    modelSlug: text('model_slug').notNull(),
    hits: integer('hits').notNull().default(0),
    lastHitAt: timestamp('last_hit_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_semantic_cache_tenant_idx').on(t.tenantId, t.lastHitAt.desc()),
    index('ai_semantic_cache_expires_idx').on(t.expiresAt),
  ],
)

// ─── member_insights ─────────────────────────────────────────────────────
/**
 * Cache cross-module 6-24h TTL (ADR 0070 esperado). Sprint 06 cria esqueleto;
 * Sprint 19+ (churn) e Sprint 27+ (cross-alert) populam.
 *
 * `insight_key` exemplos: `churn_risk_30d`, `last_workout_summary`,
 * `evolution_summary`, `payment_pattern_90d`. Cada tem TTL próprio.
 */
export const memberInsights = pgTable(
  'member_insights',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id').notNull(),
    insightKey: text('insight_key').notNull(),
    value: jsonb('value').notNull(),
    confidence: text('confidence'), // 'high' | 'medium' | 'low' opcional
    generatedBy: text('generated_by'), // 'gemini-2.5-flash' | 'sklearn-v1' | 'rule:churn_v1'
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('member_insights_member_key_uq').on(t.tenantId, t.memberId, t.insightKey),
    index('member_insights_expires_idx').on(t.expiresAt),
  ],
)

// ─── support_tickets (Sprint 06 — sistema mínimo) ────────────────────────
/**
 * Aberto via tool `report_issue` ou /app/suporte (UI manual). Sprint 13
 * email notifica admin. Categoria livre no MVP (`bug`/`question`/`other`).
 */
export const supportTicketCategoryEnum = pgEnum('support_ticket_category', [
  'bug',
  'question',
  'feature_request',
  'billing',
  'other',
])

export const supportTicketStatusEnum = pgEnum('support_ticket_status', [
  'open',
  'in_progress',
  'resolved',
  'cancelled',
])

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    category: supportTicketCategoryEnum('category').notNull().default('other'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    context: jsonb('context').notNull().default(sql`'{}'::jsonb`), // tool calls, route, persona, etc
    status: supportTicketStatusEnum('status').notNull().default('open'),
    openedByAssistant: boolean('opened_by_assistant').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('support_tickets_tenant_status_idx').on(t.tenantId, t.status, t.createdAt.desc()),
    index('support_tickets_tenant_user_idx').on(t.tenantId, t.userId, t.createdAt.desc()),
  ],
)
