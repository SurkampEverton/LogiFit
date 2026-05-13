/**
 * `@repo/ai` — fundação IA (ADR 0064 + ADR 0075).
 *
 * Re-exports:
 *   - Tipos canônicos (AITask, AssistantLayer, AssistantPersona, ResolvedModel, AIToolDefinition)
 *   - Resolver (resolveModelForTask, resolveAllForTask)
 *   - System prompt composer (buildSystemPrompt)
 *   - 7 personas + inferPersona
 *   - Tool registry (registerAITool, getAvailableTools, getToolByKey)
 *   - PII redaction (redactBeforeLLM, redactRagChunks)
 *   - Classifier (classifyInput, classifyOutput, getBlockedOutputMessage)
 *   - Cache semântico (lookupSemanticCache, writeSemanticCache)
 *   - Quotas (AI_PLAN_LIMITS, checkQuota, getPlanLimits)
 *   - Rate limit IA (checkAIRateLimit)
 */
export * from './types'
export * from './resolver'
export * from './system-prompt'
export * from './personas'
export * from './registry'
export * from './redact'
export * from './classifier'
export * from './cache'
export * from './quotas'
export * from './ratelimit'
export * from './chat'
