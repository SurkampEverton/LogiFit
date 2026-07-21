/**
 * `resolveModelForTask({task, featureKey?, tenantCtx})` — Sprint 06 Faixa B
 * (ADR 0064 + regra 32).
 *
 * Algoritmo:
 *   1. Busca `ai_task_routing` com priority crescente filtrando por:
 *      - task EXACTLY
 *      - scope = `tenant:${tenantId}` OR `feature:${featureKey}` OR 'global'
 *      - active = true
 *   2. Pra cada candidato, verifica:
 *      - Provider tem BYOK ativo no tenant? → usa key tenant
 *      - Provider é default LogiFit (Gemini)? → usa env `GEMINI_API_KEY`
 *      - Outro provider sem BYOK → pula (não pode pagar por tenant)
 *   3. Primeiro que casar = resolved.
 *
 * Sprint 06 Faixa C: cascade fallback automático em runtime (caller pega
 * `resolveAll()` e tenta priority crescente até sucesso).
 */
import { decryptSecret } from '@repo/security'
import type { ModelCapabilities, ResolveModelInput, ResolvedModel } from './types'

export interface ResolverDeps {
  /** Lê `ai_task_routing` JOIN `ai_models` JOIN `ai_providers` ordenado por priority. */
  loadRouting(input: {
    task: ResolveModelInput['task']
    tenantId: string
    featureKey?: string
  }): Promise<
    Array<{
      providerSlug: string
      modelSlug: string
      capabilities: ModelCapabilities
      priority: number
    }>
  >
  /** Lê BYOK do tenant (api_key_encrypted decifrado in-memory). */
  loadByok(input: {
    tenantId: string
    providerSlug: string
  }): Promise<{ apiKeyEncrypted: string } | null>
  /** Env fallback pra provider default LogiFit (Gemini). */
  getDefaultApiKey(providerSlug: string): string | undefined
}

/**
 * `resolveModelForTask` — encontra primeiro modelo elegível (BYOK ou default).
 *
 * Lança Error com `code='AI_PROVIDER_ERROR'` se ninguém elegível (caller
 * traduz no envelope).
 */
export async function resolveModelForTask(
  input: ResolveModelInput,
  deps: ResolverDeps,
): Promise<ResolvedModel> {
  const candidates = await deps.loadRouting({
    task: input.task,
    tenantId: input.tenantCtx.tenantId,
    featureKey: input.featureKey,
  })

  if (candidates.length === 0) {
    throw new Error(`resolveModelForTask: no routing found for task=${input.task}`)
  }

  for (const c of candidates) {
    // 1. BYOK do tenant pra este provider?
    const byok = await deps.loadByok({
      tenantId: input.tenantCtx.tenantId,
      providerSlug: c.providerSlug,
    })
    if (byok) {
      return {
        providerSlug: c.providerSlug,
        modelSlug: c.modelSlug,
        capabilities: c.capabilities,
        isByok: true,
        apiKey: decryptSecret(byok.apiKeyEncrypted),
        priority: c.priority,
      }
    }

    // 2. Default LogiFit (Gemini Vertex AI)?
    if (c.providerSlug === 'vertex-ai-gemini') {
      const defaultKey = deps.getDefaultApiKey(c.providerSlug)
      if (defaultKey) {
        return {
          providerSlug: c.providerSlug,
          modelSlug: c.modelSlug,
          capabilities: c.capabilities,
          isByok: false,
          apiKey: defaultKey,
          priority: c.priority,
        }
      }
    }

    // 3. Outro provider sem BYOK → pula (não pode pagar pelo tenant)
  }

  throw new Error(
    `resolveModelForTask: no eligible model — task=${input.task}, tenant=${input.tenantCtx.tenantId}. Configure BYOK ou habilite default Gemini.`,
  )
}

/**
 * Variante `resolveAll` retorna lista de candidatos elegíveis ordenada por
 * priority. Usado pelo cascade fallback (Sprint 06+ Faixa C).
 */
export async function resolveAllForTask(
  input: ResolveModelInput,
  deps: ResolverDeps,
): Promise<ResolvedModel[]> {
  const candidates = await deps.loadRouting({
    task: input.task,
    tenantId: input.tenantCtx.tenantId,
    featureKey: input.featureKey,
  })

  const resolved: ResolvedModel[] = []
  for (const c of candidates) {
    const byok = await deps.loadByok({
      tenantId: input.tenantCtx.tenantId,
      providerSlug: c.providerSlug,
    })
    if (byok) {
      resolved.push({
        providerSlug: c.providerSlug,
        modelSlug: c.modelSlug,
        capabilities: c.capabilities,
        isByok: true,
        apiKey: decryptSecret(byok.apiKeyEncrypted),
        priority: c.priority,
      })
      continue
    }
    if (c.providerSlug === 'vertex-ai-gemini') {
      const defaultKey = deps.getDefaultApiKey(c.providerSlug)
      if (defaultKey) {
        resolved.push({
          providerSlug: c.providerSlug,
          modelSlug: c.modelSlug,
          capabilities: c.capabilities,
          isByok: false,
          apiKey: defaultKey,
          priority: c.priority,
        })
      }
    }
  }
  return resolved
}
