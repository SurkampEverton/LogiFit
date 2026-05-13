/**
 * Rate limit IA — Sprint 06 Faixa B (regra 36 + ADR 0073).
 *
 * Sobreposto à regra 36: IA tem cap próprio mais restrito (20/min/user). Quando
 * Redis estiver disponível (Sprint 00 Faixa 3), substitui o stub abaixo.
 *
 * Chave canônica: `ai:chat:<tenant_id>:<user_id>` (60s window, max 20).
 * Outras chaves: `ai:embed:<tenant_id>` (60s, max 100); `ai:tool:<tool_key>:<tenant_id>:<user_id>` (60s, max 30).
 */
import { checkRateLimit, type RateLimitDecision } from '@repo/security'

export type AIRateLimitKind = 'chat' | 'embed' | 'tool'

export interface AIRateLimitInput {
  kind: AIRateLimitKind
  tenantId: string
  userId: string
  /** Para kind='tool', identifica qual tool (ex: 'agenda.cancelAppointment'). */
  toolKey?: string
}

export async function checkAIRateLimit(input: AIRateLimitInput): Promise<RateLimitDecision> {
  const key = buildKey(input)
  // Atualmente delega ao stub no-op de @repo/security (Sprint 00). Sprint 06+
  // Faixa C: Redis self-host com sliding window 60s + chaves nomeadas acima.
  return checkRateLimit('ai', key)
}

function buildKey(input: AIRateLimitInput): string {
  switch (input.kind) {
    case 'chat':
      return `ai:chat:${input.tenantId}:${input.userId}`
    case 'embed':
      return `ai:embed:${input.tenantId}`
    case 'tool':
      return `ai:tool:${input.toolKey ?? 'unknown'}:${input.tenantId}:${input.userId}`
  }
}
