/**
 * Generative UI — tipos canônicos.
 *   Sprint 28 (ADR 0085 esperado).
 *
 * Modelo retorna **tool calls** com schema Zod. Cada tool corresponde a um
 * componente React registrado. Cliente recebe lista de tool calls + renderiza
 * componente correspondente passando os args validados.
 *
 * **Diferente de tool registry Sprint 06** (`@repo/ai/registry`): aquelas são
 * tools de **ação** (createMember, scheduleAppointment) que executam Server
 * Actions. Aqui são tools de **renderização** — não mudam estado, só pedem
 * dados pra exibir componente rico.
 *
 * **Convenção de nomes**: `genui.<dominio>.<componente>` (ex: `genui.fisio.patient_card`).
 */
import { z } from 'zod'

/** Identificador canônico de uma tool de UI. */
export type GenUIToolName = string

/**
 * Definição de uma tool de UI registrada.
 *
 * @template TArgs Tipo dos args Zod-validados (após `parse`)
 */
export interface GenUIToolDefinition<TArgs = unknown> {
  /** Identificador canônico (`genui.<dominio>.<componente>`) */
  name: GenUIToolName
  /** Descrição que vai pro system prompt do LLM (few-shot inclusive) */
  description: string
  /** Schema Zod dos args — validação na entrada. Usamos `z.ZodTypeAny` pra
   *  acomodar schemas com `.default()` (Input ≠ Output). Cast garante runtime. */
  // biome-ignore lint/suspicious/noExplicitAny: schema com default precisa de input flexível
  argsSchema: z.ZodType<TArgs, z.ZodTypeDef, any>
  /** Categoria pra agrupar no catálogo (`clinico`/`academia`/`financeiro`/etc) */
  category: 'clinico' | 'academia' | 'nutri' | 'financeiro' | 'geral'
  /** Personas que podem disparar (Sprint 06 personas) */
  allowedPersonas?: Array<
    'member' | 'professional_clinical' | 'professional_coach' | 'admin'
  >
  /** True se a tool é read-only (não dispara mutação) — MVP todas são */
  readOnly: boolean
  /** Exemplo few-shot pro prompt (opcional) */
  example?: { args: TArgs; description: string }
}

/**
 * Tool call recebida do LLM (ainda não validada).
 */
export interface GenUIToolCall {
  /** ID único da call dentro da mensagem (LLM gera; usado pra correlacionar resultado) */
  id: string
  /** Nome canônico da tool */
  name: GenUIToolName
  /** Args raw do LLM (validados via argsSchema antes de renderizar) */
  args: unknown
}

/**
 * Tool call validada e pronta pra renderizar.
 */
export interface GenUIRenderableCall<TArgs = unknown> {
  id: string
  name: GenUIToolName
  /** Args já passados por `argsSchema.parse` — tipo seguro */
  args: TArgs
}

/**
 * Resultado da validação de uma tool call.
 */
export type GenUIValidationResult<TArgs = unknown> =
  | { ok: true; call: GenUIRenderableCall<TArgs> }
  | {
      ok: false
      /** Erro de validação (texto curto pro fallback visual) */
      reason:
        | 'unknown_tool'
        | 'schema_violation'
        | 'persona_not_allowed'
        | 'mutation_attempted'
      details?: string
    }

/**
 * Mensagem renderizada pelo `<GenUIMessage>`: texto plain + tool calls
 * intercaladas. Cada tool call vira um componente; texto vira `<p>` normal.
 *
 * Formato canônico: array de blocos. LLM pode misturar `text` + `tool_call`.
 */
export type GenUIMessageBlock =
  | { kind: 'text'; content: string }
  | { kind: 'tool_call'; call: GenUIToolCall }

/**
 * Resposta completa do endpoint Generative UI.
 */
export interface GenUIResponse {
  /** Sessão pra continuação multi-turn */
  sessionId: string | null
  /** Blocos a renderizar em ordem */
  blocks: GenUIMessageBlock[]
  /** Cota IA restante (Sprint 06 quotas) */
  quotaRemaining?: number
}
