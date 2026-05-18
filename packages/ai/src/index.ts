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

// Sprint 28 — Generative UI: registry de tools + 6 definições padrão (ADR 0085)
export * from './genui'

// Sprint 31 — Teleconsulta provider abstrato (ADR 0083): Daily/Whereby/Jitsi/Twilio + Mock dev/test
export * from './teleconsulta'

// Sprint 32 — Device Hub provider abstrato (ADR 0049): Garmin/Oura/BLE/Mock + normalizer FHIR-like + parser CSV InBody
export * from './devices'

// Sprint 33 — Pipeline Exames Laboratoriais (ADR 0050 Accepted): classifier anti-diagnóstico + extraction Zod schema + interpretation comparator + pattern detector + follow-up suggestions
export {
  classifyInterpretationOutput,
  classifyInterpretationFields,
  getBlockedMessage,
} from './exames/classifier'
export type { ClassificationResult, ClassifierStrictness } from './exames/classifier'
export {
  parseExtractionJson,
  safeParseExtractionJson,
  ExamAnalyteSchema,
  ExamExtractionSchema,
} from './exames/extraction-schema'
export type { ExamExtractionParsed, ExamAnalyteParsed } from './exames/extraction-schema'
export {
  compareWithRanges,
  detectPatterns,
  getFollowUpSuggestions,
  PATTERN_CATALOG,
} from './exames/interpretation'
export type {
  OutOfRangeItem,
  PatientContext as ExamesPatientContext,
  ReferenceRangeInput as ExamesReferenceRangeInput,
  DetectedPattern,
  PatternDefinition,
} from './exames/interpretation'

// Sprint 34 — Nutri-Agent IA cross-module (ADRs 0043+0044 esperados): pattern detector curado + suggestion generator com classifier reuse + pre-consult summary determinístico
export {
  detectRiskPatterns,
  generateSuggestionsFromPatterns,
  generatePreConsultSummary,
} from './nutri-agent'
export type {
  MemberContextSnapshot,
  MemberDemographics,
  MealPlanContext,
  DiaryDailySummary as NutriAgentDiaryDailySummary,
  WorkoutLoadSummary,
  FisioActiveCid,
  LabResultRecent,
  DeviceSummary,
  DetectedRiskPattern,
  AgentSuggestion,
} from './nutri-agent'

// Sprint 36 — Fiscal Emissions provider abstrato (ADR 0059 Accepted): FiscalProvider interface + MockFiscalProvider dev/test + resolveCfop puro 8 tipos × interno/interestadual + CANONICAL_CFOPS catálogo. Sprint 36b adiciona FocusNfeProvider real + payload builders + factory resolveFiscalProvider.
export * from './fiscal'
