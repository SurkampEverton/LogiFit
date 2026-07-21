/**
 * Tipos canônicos da camada IA — Sprint 06 Faixa B (ADR 0064 + ADR 0075).
 *
 * Não importa nada — re-exportável por qualquer pacote sem ciclo.
 */

export type AITask =
  | 'chat'
  | 'embedding'
  | 'classification'
  | 'extraction'
  | 'vision'
  | 'transcription'
  | 'reasoning'

export type AssistantLayer = 'help' | 'insight' | 'action'

export type AssistantPersona =
  | 'member'
  | 'professional_clinical'
  | 'professional_coach'
  | 'admin'
  | 'recepcao'
  | 'super_admin'
  | 'contador_externo'
  | 'dpo'

export type ProposalState = 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'failed'

export interface TenantContext {
  tenantId: string
  userId: string
  /** Plano do tenant — define cota mensal (ADR 0066). */
  planTier: 'solo' | 'solo_combo' | 'starter' | 'pro' | 'business' | 'enterprise'
  /** Locale ativo (next-intl resolved). */
  locale: 'pt-BR' | 'en-US' | 'es-419'
  /** Persona inferida ou escolhida no chip switcher. */
  persona?: AssistantPersona
  /** Verticais ativas do tenant. */
  verticals?: ReadonlyArray<'academia' | 'fisio' | 'nutri' | 'personal'>
}

export interface ResolveModelInput {
  task: AITask
  /** Override por feature flag ou config tenant (ex: 'churn-prediction'). */
  featureKey?: string
  tenantCtx: TenantContext
}

export interface ResolvedModel {
  /** Provider slug (ex: 'vertex-ai-gemini', 'anthropic'). */
  providerSlug: string
  /** Model slug (ex: 'gemini-2.5-flash'). */
  modelSlug: string
  /** Capabilities serializadas do ai_models.capabilities. */
  capabilities: ModelCapabilities
  /** True quando tenant tem BYOK ativo pra este provider. */
  isByok: boolean
  /** API key decifrada (envelope-crypto). Server-only, nunca log. */
  apiKey: string
  /** Priority ativada (100=default LogiFit, 200/300=fallback). */
  priority: number
}

export interface ModelCapabilities {
  function_calling?: boolean
  vision?: boolean
  streaming?: boolean
  context_window?: number
  output_window?: number
  embedding_dim?: number
  data_residency?: 'BR' | 'US' | 'EU' | string
  pricing?: {
    input_per_million_micros?: number
    output_per_million_micros?: number
    audio_minutes_per_micros?: number
  }
  tasks_supported?: AITask[]
}

export interface AIToolDefinition<TArgs = unknown, TResult = unknown> {
  /** Globalmente único: 'agenda.cancelAppointment', 'financeiro.applyDiscount'. */
  key: string
  /** Módulo origem (label de log/dashboard). */
  module: string
  /** Camada de capacidade — define gates. */
  layer: AssistantLayer
  /** Label curto em pt-BR (i18n no UI). */
  label: string
  /** Descrição para LLM consumir como function description (pt-BR). */
  description: string
  /** Permissão RBAC (regra 30 + ADR 0019). Vazio = liberado por persona. */
  requiredPermissions?: string[]
  /** Lookup `tenant.verticals_active` — só carrega se vertical ativa. */
  requiredVertical?: 'academia' | 'fisio' | 'nutri' | 'personal'
  /** Personas em que aparece. */
  showInPersonas: AssistantPersona[]
  /** Camada 3 só executa via ActionConfirmDialog. */
  requiresConfirmation: boolean
  /** Bloqueada explicitamente (gera linha `is_ai_blocked=true` no registry). */
  blocked?: { reason: string }
  /** Schema de args — passamos Zod JSON schema serializado. */
  argsSchemaJson?: Record<string, unknown>
  /** Schema do resultado — serializado pra registry. */
  resultSchemaJson?: Record<string, unknown>
  /** Handler real — Server Action wrapAction. */
  handler?: (args: TArgs, ctx: TenantContext) => Promise<TResult>
  /** Override rate-limit; default = `ai.tool.<module>`. */
  rateLimitKey?: string
  /** Quando false, esconde mesmo da persona — usado em flag dinâmica. */
  whenAvailable?: (ctx: TenantContext) => boolean
}

export interface AssistantSystemPromptInput {
  persona: AssistantPersona
  tenantCtx: TenantContext
  /** Tools disponíveis na turn (filtradas por persona/permission/vertical). */
  availableTools: AIToolDefinition[]
  /** White-label name (default 'Copilot'). */
  assistantName: string
  /** Sumário de RAG chunks recuperados (pode estar vazio). */
  ragSnippets?: Array<{ source: string; content: string }>
  /** Contexto extra de rota (ex: 'member_id=abc' quando em /app/members/abc). */
  routeContext?: Record<string, string>
}

export interface PiiRedactionResult {
  redacted: string
  /** Quantas vezes cada padrão bateu (auditoria). */
  hits: Record<string, number>
}

export interface ClassifierResult {
  /** True quando bloqueado (mostra disclaimer + abre `ai_incidents`). */
  blocked: boolean
  /** Razão legível pro audit log. */
  reason?: 'prescription' | 'diagnosis' | 'prohibited_term' | 'injection_attempt'
  /** Pattern que bateu, pra retro. */
  match?: string
}
