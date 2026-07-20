/**
 * IA arquitetura — Sprint 06 Faixa A (ADR 0064 + 0075).
 *
 * 10 tabelas core:
 *   GLOBAIS (sem tenant_id):
 *     - `ai_providers` (catálogo: Gemini/OpenAI/Anthropic/Groq/Maritaca)
 *     - `ai_models` (modelo por provider, capabilities, preço)
 *     - `ai_task_routing` (qual modelo pra qual task, priority cascade)
 *     - `tools_registry` (catálogo de tools registradas via registerAITool)
 *
 *   TENANT-SCOPED:
 *     - `ai_provider_configs` (BYOK keys cifrados; default LogiFit ausente)
 *     - `ai_tenant_usage` (cota mensal: tokens/calls/cost por mês)
 *     - `ai_audit_log` (cada chamada — Sprint 06+ particionado por mês ADR 0072)
 *     - `assistant_sessions` (conversas)
 *     - `assistant_messages` (turns por sessão)
 *     - `assistant_action_proposals` (Camada 3 confirmação UI — ADR 0075)
 *
 * RAG (ai_documents + ai_document_chunks + ai_semantic_cache + member_insights)
 * fica Faixa B do Sprint 06 — schemas + ingestão + queries em arquivo próprio.
 *
 * **Particionamento `ai_audit_log`**: previsão 30M+ rows/ano. Sprint 06+ Faixa C
 * adiciona PARTITION BY RANGE (created_at) mensal + retenção 1y hot + 5y cold
 * (regra 34 + CFM 2.454/2026). MVP cabe single table até primeiro tenant
 * ativo + 30 dias.
 *
 * @volume_estimate_yearly: 30000000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
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
import { users } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const aiTaskEnum = pgEnum('ai_task', [
  'chat', // conversa multi-turn
  'embedding', // gera vetor pra RAG/similaridade
  'classification', // categoriza texto (ex: intent, sentiment)
  'extraction', // extrai entidades estruturadas (JSON output)
  'vision', // input com imagem
  'transcription', // áudio → texto (Whisper)
  'reasoning', // problemas complexos com chain-of-thought
])

export const assistantLayerEnum = pgEnum('assistant_layer', [
  'help', // RAG read-only
  'insight', // read data via Server Action
  'action', // write via Server Action — confirmação UI obrigatória
])

export const assistantPersonaEnum = pgEnum('assistant_persona', [
  'member',
  'professional_clinical',
  'professional_coach',
  'admin',
  'recepcao',
  'super_admin',
  'contador_externo',
  'dpo',
])

export const proposalStateEnum = pgEnum('proposal_state', [
  'pending', // criada, aguarda confirm UI
  'confirmed', // user clicou Confirmar → handler executou
  'cancelled', // user clicou Cancelar
  'expired', // 5min sem ação
  'failed', // handler erros pós-confirm
])

// ─── ai_providers (global, sem tenant) ──────────────────────────────────
export const aiProviders = pgTable('ai_providers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  slug: text('slug').notNull().unique(), // 'vertex-ai-gemini', 'anthropic', 'openai', 'groq', 'maritaca'
  name: text('name').notNull(), // 'Vertex AI (Google Gemini)'
  apiBaseUrl: text('api_base_url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── ai_models (global) ─────────────────────────────────────────────────
export const aiModels = pgTable(
  'ai_models',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => aiProviders.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(), // 'gemini-2.5-flash', 'claude-3-5-sonnet-20241022', etc
    name: text('name').notNull(),
    capabilities: jsonb('capabilities').notNull(), // {function_calling, vision, streaming, context_window, pricing}
    deprecated: boolean('deprecated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_models_provider_slug_uq').on(t.providerId, t.slug),
    index('ai_models_active_idx').on(t.providerId).where(sql`deprecated = false`),
  ],
)

// ─── ai_task_routing (global) ───────────────────────────────────────────
/**
 * Define qual modelo pra qual task com priority (1=default LogiFit, 2+=fallback cascade).
 * `scope` permite override per-tenant ou per-feature em Sprint 06+ Faixa C.
 */
export const aiTaskRouting = pgTable(
  'ai_task_routing',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    task: aiTaskEnum('task').notNull(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => aiModels.id, { onDelete: 'restrict' }),
    priority: integer('priority').notNull().default(100), // 1=mais alto; 100=default LogiFit
    scope: text('scope').notNull().default('global'), // 'global' | 'tenant:<uuid>' | 'feature:<key>'
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_task_routing_task_idx').on(t.task, t.priority).where(sql`active = true`),
    index('ai_task_routing_scope_idx').on(t.scope).where(sql`active = true`),
  ],
)

// ─── ai_provider_configs (tenant — BYOK) ────────────────────────────────
/**
 * BYOK opcional por tenant. `api_key_encrypted` via @repo/security/envelope-crypto.
 * `enabled=true` + key válida → bypass quota LogiFit; tenant paga direto.
 */
export const aiProviderConfigs = pgTable(
  'ai_provider_configs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => aiProviders.id, { onDelete: 'restrict' }),
    apiKeyEncrypted: text('api_key_encrypted').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestResult: text('last_test_result'), // 'ok' | 'invalid' | 'rate_limited' | etc
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_provider_configs_tenant_provider_uq').on(t.tenantId, t.providerId)],
)

// ─── ai_tenant_usage (cota mensal) ──────────────────────────────────────
/**
 * 1 row por (tenant, month). Atualiza incremental via UPDATE ... SET calls_count = calls_count + 1.
 *
 * Circuit breaker: caller verifica `calls_count < limit_for_tier(tenant.plan_tier)` antes
 * de gerar nova chamada. Limites em `plan_tier_rates` (Sprint 04+ ADR 0066).
 */
export const aiTenantUsage = pgTable(
  'ai_tenant_usage',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    monthBucket: text('month_bucket').notNull(), // 'YYYY-MM'
    callsCount: integer('calls_count').notNull().default(0),
    tokensInput: integer('tokens_input').notNull().default(0),
    tokensOutput: integer('tokens_output').notNull().default(0),
    costMicros: integer('cost_micros').notNull().default(0), // $1.00 = 1_000_000
    cacheHits: integer('cache_hits').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_tenant_usage_tenant_month_uq').on(t.tenantId, t.monthBucket)],
)

// ─── ai_audit_log (tenant) ──────────────────────────────────────────────
/**
 * Cada chamada LLM. Sprint 06+ particiona por created_at mensal.
 * Retenção: 1y hot + 5y cold (CFM 2.454/2026 exige; ADR 0072).
 *
 * `guardrail_blocked=true` quando classificador de output (regra 28) bloqueou
 * (prescrição/diagnóstico). `fallback_used=true` quando cascade fallback rodou.
 */
export const aiAuditLog = pgTable(
  'ai_audit_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').references(() => users.id),
    sessionId: uuid('session_id'), // FK pra assistant_sessions (set null on delete)
    task: aiTaskEnum('task').notNull(),
    modelSlug: text('model_slug').notNull(),
    providerSlug: text('provider_slug').notNull(),
    persona: assistantPersonaEnum('persona'),
    layer: assistantLayerEnum('layer'),
    promptHash: text('prompt_hash'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costMicros: integer('cost_micros').notNull().default(0),
    latencyMs: integer('latency_ms'),
    cacheHit: boolean('cache_hit').notNull().default(false),
    fallbackUsed: boolean('fallback_used').notNull().default(false),
    guardrailBlocked: boolean('guardrail_blocked').notNull().default(false),
    actionProposalId: uuid('action_proposal_id'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_audit_log_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('ai_audit_log_session_idx').on(t.sessionId),
    index('ai_audit_log_user_idx').on(t.userId, t.createdAt),
    index('ai_audit_log_guardrail_idx')
      .on(t.tenantId, t.createdAt)
      .where(sql`guardrail_blocked = true`),
  ],
)

// ─── assistant_sessions ─────────────────────────────────────────────────
export const assistantSessions = pgTable(
  'assistant_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }), // contexto opcional
    title: text('title').notNull().default('Nova conversa'),
    persona: assistantPersonaEnum('persona').notNull(),
    contextPath: text('context_path'), // route ativa quando iniciou
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assistant_sessions_tenant_user_idx').on(t.tenantId, t.userId, t.updatedAt),
    index('assistant_sessions_active_idx').on(t.tenantId, t.userId).where(sql`archived_at IS NULL`),
  ],
)

// ─── assistant_messages ─────────────────────────────────────────────────
export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => assistantSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant' | 'tool' | 'system'
    content: text('content').notNull(),
    toolCalls: jsonb('tool_calls'), // array de calls quando role=assistant
    toolResults: jsonb('tool_results'), // resultado quando role=tool
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assistant_messages_session_idx').on(t.sessionId, t.createdAt),
    index('assistant_messages_tenant_created_idx').on(t.tenantId, t.createdAt),
    check(
      'assistant_messages_role_valid',
      sql`${t.role} IN ('user', 'assistant', 'tool', 'system')`,
    ),
  ],
)

// ─── assistant_action_proposals (Camada 3 ADR 0075) ─────────────────────
/**
 * LLM propõe ação write → row criada em `pending` → UI mostra ConfirmDialog →
 * user confirma → handler real verifica `proposalId` + chama Server Action.
 *
 * Expira em 5min (Sprint 06+ Faixa B: cron limpa pending > 5min como `expired`).
 */
export const assistantActionProposals = pgTable(
  'assistant_action_proposals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => assistantSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toolKey: text('tool_key').notNull(), // 'agenda.cancelAppointment' etc — FK lógica pra tools_registry.key
    args: jsonb('args').notNull(),
    confirmationCopy: jsonb('confirmation_copy').notNull(), // {title, description, impact, affectedEntities}
    state: proposalStateEnum('state').notNull().default('pending'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    executionResult: jsonb('execution_result'),
    executionError: text('execution_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('action_proposals_tenant_user_idx').on(t.tenantId, t.userId, t.createdAt),
    index('action_proposals_pending_idx').on(t.tenantId).where(sql`state = 'pending'`),
  ],
)

// ─── tools_registry (global) ────────────────────────────────────────────
/**
 * Catálogo de tools registradas via `registerAITool()`. Sprint 06+ Faixa B
 * carrega no boot do app (mesmo padrão de search_index regra 30 + menu-items
 * Sprint 00b).
 *
 * `layer` indica capacidade. `requires_confirmation=true` em todas Layer 3.
 */
export const toolsRegistry = pgTable(
  'tools_registry',
  {
    key: text('key').primaryKey(), // 'agenda.cancelAppointment', 'financeiro.applyDiscount'
    module: text('module').notNull(),
    label: text('label').notNull(),
    description: text('description').notNull(),
    layer: assistantLayerEnum('layer').notNull(),
    showInPersonas: jsonb('show_in_personas').notNull(), // array of assistantPersonaEnum values
    requiredPermissions: jsonb('required_permissions').notNull(), // array of permission keys
    argsSchema: jsonb('args_schema').notNull(), // Zod JSON schema
    resultSchema: jsonb('result_schema').notNull(),
    requiresConfirmation: boolean('requires_confirmation').notNull().default(false),
    rateLimitKey: text('rate_limit_key'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tools_registry_module_idx').on(t.module).where(sql`active = true`),
    index('tools_registry_layer_idx').on(t.layer).where(sql`active = true`),
  ],
)
