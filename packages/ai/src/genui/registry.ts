/**
 * Generative UI — registry de tools.
 *   Sprint 28 (ADR 0085 esperado).
 *
 * Singleton map mantém `Record<toolName, GenUIToolDefinition>` em memória.
 * Cliente (UI) consulta `getRegisteredTools()` pra renderizar; servidor consome
 * via `validateToolCall()` antes de enviar pra `<GenUIMessage>`.
 *
 * **Não persiste em DB** — diferente de `tools_registry` Sprint 06 (que é
 * catálogo de tools de ação com permissões). GenUI registry é estritamente
 * runtime, vive enquanto processo Next.js está vivo.
 */
import type { z } from 'zod'
import type {
  GenUIRenderableCall,
  GenUIToolCall,
  GenUIToolDefinition,
  GenUIToolName,
  GenUIValidationResult,
} from './types'

const REGISTRY = new Map<GenUIToolName, GenUIToolDefinition<unknown>>()

/**
 * Registra uma tool de UI. Chamado uma vez por tool (geralmente em
 * `packages/ai/src/genui/tools.ts` no boot).
 *
 * Idempotente: re-registrar a mesma tool sobrescreve (útil pra HMR).
 */
export function registerUIComponent<TArgs>(def: GenUIToolDefinition<TArgs>): void {
  REGISTRY.set(def.name, def as GenUIToolDefinition<unknown>)
}

/**
 * Retorna definição por nome (ou undefined se não registrada).
 */
export function getToolDefinition(name: GenUIToolName): GenUIToolDefinition | undefined {
  return REGISTRY.get(name)
}

/**
 * Lista todas as tools registradas. Útil pra construir prompt do LLM ou pra
 * styleguide do catálogo.
 */
export function getRegisteredTools(): GenUIToolDefinition[] {
  return Array.from(REGISTRY.values())
}

/**
 * Filtra tools disponíveis para uma persona.
 */
export function getToolsForPersona(persona: string): GenUIToolDefinition[] {
  return getRegisteredTools().filter(
    (t) =>
      t.allowedPersonas === undefined ||
      (t.allowedPersonas as string[]).includes(persona),
  )
}

/**
 * Limpa o registry (uso em testes).
 */
export function clearRegistry(): void {
  REGISTRY.clear()
}

/**
 * Valida uma tool call vinda do LLM. Retorna resultado discriminado: se ok,
 * inclui args com tipo seguro; se erro, descreve o motivo.
 *
 * **Guardrails enforced aqui** (regra 28 + ADR 0085):
 *   1. Tool não-registrada → `unknown_tool`
 *   2. Args não passam pelo Zod → `schema_violation`
 *   3. Persona não permitida → `persona_not_allowed`
 *   4. Tool tentou mutação (readOnly=false e MVP só aceita true) → `mutation_attempted`
 */
export function validateToolCall(
  call: GenUIToolCall,
  ctx: { persona?: string } = {},
): GenUIValidationResult {
  const def = REGISTRY.get(call.name)
  if (!def) {
    return { ok: false, reason: 'unknown_tool', details: call.name }
  }

  if (!def.readOnly) {
    return {
      ok: false,
      reason: 'mutation_attempted',
      details: `Tool ${call.name} declarada como não-readOnly; bloqueado em GenUI MVP (ADR 0085)`,
    }
  }

  if (
    ctx.persona &&
    def.allowedPersonas &&
    !(def.allowedPersonas as string[]).includes(ctx.persona)
  ) {
    return {
      ok: false,
      reason: 'persona_not_allowed',
      details: `Persona ${ctx.persona} não pode invocar ${call.name}`,
    }
  }

  const parsed = (def.argsSchema as z.ZodType).safeParse(call.args)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'schema_violation',
      details: parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    }
  }

  const renderable: GenUIRenderableCall = {
    id: call.id,
    name: call.name,
    args: parsed.data,
  }
  return { ok: true, call: renderable }
}
