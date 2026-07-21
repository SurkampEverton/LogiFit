/**
 * `chatComplete` — wrapper canônico de chat completion (ADR 0064).
 *
 * Sprint 06 Faixa C/D real: chama Vercel AI SDK com modelo resolvido por
 * `resolveModelForTask()`. Se o provider/modelo não tem credentials configurados,
 * cai em stub determinístico que ecoa a mensagem com disclaimer — degrada
 * graciosamente em dev sem GEMINI_API_KEY.
 *
 * Pipeline:
 *   1. classifyInput(userMessage) → bloqueia injection
 *   2. redactBeforeLLM(userMessage + ragChunks) — defense-in-depth
 *   3. buildSystemPrompt(persona, tools, rag, tenantCtx)
 *   4. chamada provider via Vercel AI SDK (Gemini → Claude → GPT)
 *   5. classifyOutput(assistantText) → bloqueia prescrição/diagnóstico
 *   6. retorna { text, model, providerSlug, tokens, latencyMs, guardrail }
 *
 * `streamComplete` é variante streaming SSE (Sprint 06+ Faixa D real). MVP API
 * Route `/api/ai/chat` usa `chatComplete` síncrono — streaming chega depois.
 */
import { generateText } from 'ai'
import { classifyInput, classifyOutput, getBlockedOutputMessage } from './classifier'
import { redactBeforeLLM, redactRagChunks } from './redact'
import { buildSystemPrompt } from './system-prompt'
import type { AIToolDefinition, AssistantPersona, ResolvedModel, TenantContext } from './types'

export interface ChatCompleteInput {
  tenantCtx: TenantContext
  persona: AssistantPersona
  resolved: ResolvedModel
  userMessage: string
  /** Histórico de turns (já persistido em assistant_messages) — opcional. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Tools filtradas via getAvailableTools(). */
  availableTools: AIToolDefinition[]
  /** RAG chunks recuperados (redacted antes do prompt). */
  ragSnippets?: Array<{ source: string; content: string }>
  /** White-label name. */
  assistantName: string
  /** Contexto extra de rota (ex: { member_id: 'abc' }). */
  routeContext?: Record<string, string>
}

export interface ChatCompleteResult {
  text: string
  modelSlug: string
  providerSlug: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  guardrailBlocked: boolean
  guardrailReason?: string
  /** True quando caiu no stub (sem provider real). */
  stubUsed: boolean
}

/**
 * Factory dos clients por provider. Sprint 06 Faixa C/D real: cada provider
 * mapeia pra função do Vercel AI SDK. Caller fornece `apiKey` resolvido.
 *
 * **Gemini**: `@ai-sdk/google` espera `GOOGLE_GENERATIVE_AI_API_KEY` env OR
 * `createGoogleGenerativeAI({apiKey})`. Vertex AI tem provider separado mas no
 * MVP o LogiFit usa Gemini API direto (mais simples; Vertex AI SP exige
 * service account JSON — fica pra Sprint 06+ ENV setup).
 */
async function callProvider(
  resolved: ResolvedModel,
  prompt: string,
  systemPrompt: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  // Lazy import pra evitar carregar SDK quando não precisa (testes unit não
  // estouram pacotes não-instalados).
  if (resolved.providerSlug === 'vertex-ai-gemini') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const google = createGoogleGenerativeAI({ apiKey: resolved.apiKey })
    const result = await generateText({
      model: google(resolved.modelSlug),
      prompt,
      system: systemPrompt,
    })
    return {
      text: result.text,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    }
  }
  if (resolved.providerSlug === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic')
    const anthropic = createAnthropic({ apiKey: resolved.apiKey })
    const result = await generateText({
      model: anthropic(resolved.modelSlug),
      prompt,
      system: systemPrompt,
    })
    return {
      text: result.text,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    }
  }
  if (resolved.providerSlug === 'openai') {
    const { createOpenAI } = await import('@ai-sdk/openai')
    const openai = createOpenAI({ apiKey: resolved.apiKey })
    const result = await generateText({
      model: openai(resolved.modelSlug),
      prompt,
      system: systemPrompt,
    })
    return {
      text: result.text,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    }
  }
  // Groq, Maritaca: Sprint 06+ Faixa C2 (adapter próprio HTTP) — por enquanto
  // qualquer provider desconhecido cai pro stub.
  throw new Error(`callProvider: provider ${resolved.providerSlug} ainda não tem adapter (MVP).`)
}

function stubFallback(
  userMessage: string,
  persona: AssistantPersona,
  locale: TenantContext['locale'],
): { text: string; inputTokens: number; outputTokens: number } {
  const opener = { 'pt-BR': 'Olá! ', 'en-US': 'Hello! ', 'es-419': '¡Hola! ' }[locale]
  const note = {
    'pt-BR':
      ' (Resposta-stub do assistente — GEMINI_API_KEY ausente no ambiente. Configure via /app/settings/ia BYOK ou ENV pro LLM real responder.)',
    'en-US':
      ' (Stub response — GEMINI_API_KEY missing. Configure via /app/settings/ia BYOK or ENV for the real LLM to respond.)',
    'es-419':
      ' (Respuesta-stub — GEMINI_API_KEY ausente. Configure via /app/settings/ia BYOK o ENV para que el LLM real responda.)',
  }[locale]
  const text = `${opener}Recebi sua pergunta como ${persona}: "${userMessage.slice(0, 80)}".${note}`
  return {
    text,
    inputTokens: Math.ceil(userMessage.length / 4),
    outputTokens: Math.max(10, Math.ceil(text.length / 4)),
  }
}

export async function chatComplete(input: ChatCompleteInput): Promise<ChatCompleteResult> {
  // 1. Input classifier (anti-injection)
  const inputClassif = classifyInput(input.userMessage)
  if (inputClassif.blocked) {
    return {
      text: getBlockedOutputMessage(inputClassif.reason),
      modelSlug: 'guardrail',
      providerSlug: 'logifit-internal',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      guardrailBlocked: true,
      guardrailReason: inputClassif.reason,
      stubUsed: false,
    }
  }

  // 2. PII redact + RAG redact
  const { redacted: redactedUser } = redactBeforeLLM(input.userMessage)
  const redactedRag = input.ragSnippets ? redactRagChunks(input.ragSnippets) : undefined

  // 3. System prompt composto
  const systemPrompt = buildSystemPrompt({
    persona: input.persona,
    tenantCtx: input.tenantCtx,
    availableTools: input.availableTools,
    assistantName: input.assistantName,
    ragSnippets: redactedRag,
    routeContext: input.routeContext,
  })

  // 4. Chamada provider (fallback stub se sem credentials)
  const t0 = Date.now()
  let providerResult: { text: string; inputTokens: number; outputTokens: number }
  let stubUsed = false
  try {
    if (!input.resolved.apiKey) {
      throw new Error('apiKey vazia — fallback stub')
    }
    providerResult = await callProvider(input.resolved, redactedUser, systemPrompt)
  } catch (err) {
    // Log estruturado pro Sprint 06+ GlitchTip; MVP só console
    console.warn(
      JSON.stringify({
        level: 'warn',
        module: 'ai.chat',
        msg: 'provider call failed, falling back to stub',
        provider: input.resolved.providerSlug,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    providerResult = stubFallback(redactedUser, input.persona, input.tenantCtx.locale)
    stubUsed = true
  }
  const latencyMs = Date.now() - t0

  // 5. Output classifier (clínico)
  let finalText = providerResult.text
  let guardrailBlocked = false
  let guardrailReason: string | undefined
  const outClassif = classifyOutput(providerResult.text)
  if (outClassif.blocked) {
    finalText = getBlockedOutputMessage(outClassif.reason)
    guardrailBlocked = true
    guardrailReason = outClassif.reason
  }

  return {
    text: finalText,
    modelSlug: stubUsed ? `${input.resolved.modelSlug}-stub` : input.resolved.modelSlug,
    providerSlug: input.resolved.providerSlug,
    inputTokens: providerResult.inputTokens,
    outputTokens: providerResult.outputTokens,
    latencyMs,
    guardrailBlocked,
    guardrailReason,
    stubUsed,
  }
}

/**
 * Helper: `resolveModelOrStub()` — atalho pra caller que só precisa de
 * `{ providerSlug, modelSlug, apiKey, capabilities, priority, isByok }` sem
 * passar pelo resolver de DB (ex: testes unit ou dev sem Postgres).
 *
 * Lê `GEMINI_API_KEY` ENV; se ausente, retorna shape vazio que dispara stub
 * no `chatComplete`.
 */
export function resolveModelOrStubFromEnv(): ResolvedModel {
  const apiKey = process.env.GEMINI_API_KEY ?? ''
  return {
    providerSlug: 'vertex-ai-gemini',
    modelSlug: 'gemini-2.5-flash',
    capabilities: {
      function_calling: true,
      vision: true,
      streaming: true,
      context_window: 1_048_576,
    },
    isByok: false,
    apiKey,
    priority: 100,
  }
}
