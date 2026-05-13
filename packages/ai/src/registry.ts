/**
 * `registerAITool()` + `getAvailableTools()` — Sprint 06 Faixa B (ADR 0075 +
 * regra 41).
 *
 * **Tool registry distribuído**: cada módulo cria `apps/web/app/(modules)/<modulo>/ai-tools.ts`
 * chamando `registerAITool({...})`. Boot do app importa esses arquivos e popula
 * o manifest in-memory. Sprint 06+ Faixa C sincroniza com `tools_registry` no DB
 * (idêntico ao padrão `registerMenuItem` Sprint 00b + `search_index` regra 30).
 *
 * Lookup runtime: `getAvailableTools({persona, user, route})` retorna só tools
 * onde `whenAvailable({user})` é true + persona ∈ `showInPersonas` + RBAC
 * cobre `requiredPermissions`. Reduz tokens (10-15 tools enviadas em vez de 200).
 */
import type {
  AIToolDefinition,
  AssistantPersona,
  TenantContext,
} from './types'

const MANIFEST = new Map<string, AIToolDefinition>()

/**
 * Registra tool — idempotente (chama múltiplas vezes com mesmo key sobrescreve).
 *
 * @throws se key já existe E `blocked` está sendo redefinida (proteção dupla
 * pra `// ai-blocked` no handler).
 */
export function registerAITool<TArgs, TResult>(
  definition: AIToolDefinition<TArgs, TResult>,
): void {
  const existing = MANIFEST.get(definition.key)
  if (existing?.blocked && !definition.blocked) {
    throw new Error(
      `registerAITool: tool '${definition.key}' está marcada como ai-blocked (motivo: ${existing.blocked.reason}). Remova o // ai-blocked no handler antes de re-registrar.`,
    )
  }
  MANIFEST.set(definition.key, definition as AIToolDefinition)
}

/**
 * Retorna lista de tools disponíveis pra (persona, user, route, vertical).
 * Filtra silenciosamente — tools bloqueadas/sem permission não aparecem.
 */
export interface GetAvailableToolsInput {
  persona: AssistantPersona
  tenantCtx: TenantContext
  /** Permissões ativas do user (RBAC list_user_permissions). */
  permissions: string[]
  /** Route ativa, opcional — pode priorizar tools (ex: financeiro em /app/financeiro). */
  route?: string
}

export function getAvailableTools(input: GetAvailableToolsInput): AIToolDefinition[] {
  const permSet = new Set(input.permissions)
  const verticalSet = new Set(input.tenantCtx.verticals ?? [])

  const all = Array.from(MANIFEST.values())

  return all.filter((tool) => {
    if (tool.blocked) return false
    if (!tool.showInPersonas.includes(input.persona)) return false

    if (tool.requiredVertical && !verticalSet.has(tool.requiredVertical)) return false

    if (tool.requiredPermissions && tool.requiredPermissions.length > 0) {
      const hasAll = tool.requiredPermissions.every((p) => permSet.has(p))
      if (!hasAll) return false
    }

    if (tool.whenAvailable && !tool.whenAvailable(input.tenantCtx)) return false

    return true
  })
}

/**
 * Helper de teste/dashboard: lista todas as tools registradas (inclui bloqueadas).
 */
export function listAllTools(): AIToolDefinition[] {
  return Array.from(MANIFEST.values())
}

/**
 * Reset do manifest — usado por testes. Não chamar em prod.
 */
export function _resetRegistryForTests(): void {
  MANIFEST.clear()
}

/**
 * Lookup direto por key.
 */
export function getToolByKey(key: string): AIToolDefinition | undefined {
  return MANIFEST.get(key)
}
