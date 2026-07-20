'use server'

/**
 * Server Actions Generative UI — Sprint 28 Faixa C (ADR 0085).
 *
 * `composeGenUIResponse(input)` é o entrypoint canônico:
 *   1. Recebe `prompt` + `persona`
 *   2. Pergunta ao LLM (Vercel AI SDK) gerar resposta com tool calls
 *      respeitando o catálogo de tools disponíveis pra persona
 *   3. Valida cada tool call via `validateToolCall` (ADR 0085 §guardrails)
 *   4. Persiste assistant_messages.tool_calls (Sprint 06 schema)
 *   5. Retorna blocos prontos pra `<GenUIMessage>`
 *
 * **Sprint 28 MVP**: LLM call é **stub determinístico** — pra entregar o
 * framework + UI completo + audit + tests sem depender de Vertex AI configurado.
 * Sprint 28b conecta LLM real via `resolveModelForTask('chat')` + tool calling.
 *
 * Lint custom `no-unwrapped-action` exige `wrapServerAction`.
 */

import { randomUUID } from 'node:crypto'
import {
  type GenUIMessageBlock,
  type GenUIResponse,
  registerDefaultGenUITools,
  validateToolCall,
} from '@repo/ai'
import { db } from '@repo/db/client'
import { assistantMessages, assistantSessions } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// Garante registry populado no boot (idempotente)
registerDefaultGenUITools()

const ComposeInputSchema = z.object({
  prompt: z.string().min(2).max(2000),
  /** Sessão existente (opcional — primeiro turno cria nova) */
  sessionId: z.string().uuid().nullable().optional(),
  /** Persona ativa (Sprint 06) — vai pro guardrail de `validateToolCall` */
  persona: z
    .enum([
      'member',
      'professional_clinical',
      'professional_coach',
      'admin',
      'recepcao',
      'super_admin',
      'contador_externo',
      'dpo',
    ])
    .default('professional_clinical'),
  /** Member focado (quando aplicável) — preenche contexto pros tool args */
  memberId: z.string().uuid().nullable().optional(),
})

/**
 * Stub determinístico que devolve uma resposta plausível dado um prompt.
 * Sprint 28b: substituir pelo LLM real via `resolveModelForTask('chat')`
 * + tool calling (Vercel AI SDK).
 */
function stubLlmResponse(input: {
  prompt: string
  memberId: string | null
  persona: string
}): GenUIMessageBlock[] {
  const promptLower = input.prompt.toLowerCase()
  const memberId = input.memberId ?? '00000000-0000-0000-0000-000000000001'

  // Heurística simples baseada em keywords pra demonstrar o framework
  const wantsResumo = /resumo|relatorio|relat[óo]rio|panorama/.test(promptLower)
  const wantsEvolucao = /evolu[çc][ãa]o|gr[áa]fico|progresso|hist[óo]rico/.test(promptLower)
  const wantsCid = /cid|diagn[óo]stico|prov[áa]vel/.test(promptLower)
  const wantsExercicios = /exerc[íi]cios|treino|ficha|recomenda/.test(promptLower)
  const wantsComparacao = /antes|depois|compara|antropometria|medidas/.test(promptLower)

  const blocks: GenUIMessageBlock[] = []

  if (wantsResumo || wantsEvolucao || wantsCid || wantsExercicios || wantsComparacao) {
    blocks.push({
      kind: 'text',
      content: 'Aqui está o que encontrei sobre o paciente:',
    })

    if (wantsResumo) {
      blocks.push({
        kind: 'tool_call',
        call: {
          id: randomUUID(),
          name: 'genui.fisio.patient_card',
          args: {
            memberId,
            name: 'Marcelo Silva',
            age: 42,
            vertical: 'fisio',
            contractStatus: 'active',
            lastVisitAt: '2026-05-10T14:30:00.000Z',
            activeRisks: ['lombalgia crônica', 'baixa frequência 7d'],
          },
        },
      })
    }

    if (wantsEvolucao) {
      blocks.push({
        kind: 'tool_call',
        call: {
          id: randomUUID(),
          name: 'genui.fisio.evolution_chart',
          args: {
            memberId,
            metric: 'EVA dor lombar',
            unit: 'pts',
            points: [
              { at: '2026-03-01T00:00:00.000Z', value: 8 },
              { at: '2026-03-15T00:00:00.000Z', value: 7 },
              { at: '2026-04-01T00:00:00.000Z', value: 6 },
              { at: '2026-04-15T00:00:00.000Z', value: 5 },
              { at: '2026-05-01T00:00:00.000Z', value: 3 },
            ],
            referenceRange: { min: 0, max: 3, label: 'sem dor / leve' },
          },
        },
      })
    }

    if (wantsCid) {
      blocks.push({
        kind: 'tool_call',
        call: {
          id: randomUUID(),
          name: 'genui.fisio.cid_suggestion',
          args: {
            cids: [
              {
                code: 'MG30.0',
                description: 'Dor lombar baixa não específica',
                confidence: 0.86,
                rationale: 'Queixa principal + ausência de sintomas radiculares + EVA 5',
              },
              {
                code: 'MG30.1',
                description: 'Dor lombar com sintomas radiculares',
                confidence: 0.32,
                rationale: 'Diferencial — descartar se anamnese apontar irradiação',
              },
            ],
            targetConsultaId: null,
          },
        },
      })
    }

    if (wantsExercicios) {
      blocks.push({
        kind: 'tool_call',
        call: {
          id: randomUUID(),
          name: 'genui.fisio.exercise_recommendation',
          args: {
            goal: 'Reabilitação lombar D+30',
            exercises: [
              {
                exerciseId: '00000000-0000-0000-0000-000000000010',
                name: 'Ponte glútea',
                muscleGroups: ['glúteo', 'core', 'lombar'],
                contraindicationFlag: null,
                sets: 3,
                reps: '12-15',
                rationale: 'Ativa core + estabiliza pelve sem carga axial',
              },
              {
                exerciseId: '00000000-0000-0000-0000-000000000011',
                name: 'Bird-dog',
                muscleGroups: ['core', 'paravertebrais'],
                contraindicationFlag: null,
                sets: 3,
                reps: '10 por lado',
                rationale: 'Estabilização lombar progressiva (McGill)',
              },
              {
                exerciseId: '00000000-0000-0000-0000-000000000012',
                name: 'Agachamento livre com barra',
                muscleGroups: ['quadríceps', 'glúteo', 'lombar'],
                contraindicationFlag: 'avoid',
                rationale: 'Carga axial alta — substituir por leg press 45° fase aguda (ADR 0084)',
              },
            ],
          },
        },
      })
    }

    if (wantsComparacao) {
      blocks.push({
        kind: 'tool_call',
        call: {
          id: randomUUID(),
          name: 'genui.geral.measurement_comparison',
          args: {
            memberId,
            metrics: [
              { name: 'Peso', unit: 'kg', before: 88.5, after: 84.2, desiredDirection: 'lower' },
              { name: 'Cintura', unit: 'cm', before: 102, after: 96, desiredDirection: 'lower' },
              { name: 'IMC', unit: '', before: 28.4, after: 27.0, desiredDirection: 'lower' },
              { name: 'EVA dor', unit: 'pts', before: 8, after: 3, desiredDirection: 'lower' },
            ],
            beforeAt: '2026-03-01T00:00:00.000Z',
            afterAt: '2026-05-01T00:00:00.000Z',
          },
        },
      })
    }

    blocks.push({
      kind: 'tool_call',
      call: {
        id: randomUUID(),
        name: 'genui.geral.report_section',
        args: {
          title: 'Próximos passos sugeridos',
          tone: 'info',
          body: 'Recomendo seguir com o **protocolo de reabilitação lombar** por mais 4 semanas, com reavaliação semanal:\n\n- Manter ponte glútea + bird-dog (3×/semana)\n- Substituir agachamento livre por **leg press 45°** (ADR 0084)\n- Reavaliar EVA semana 4 — objetivo ≤ 2',
        },
      },
    })
    return blocks
  }

  // Fallback: resposta texto sem tool calls
  return [
    {
      kind: 'text',
      content:
        'Posso ajudar com resumo do paciente, evolução de métricas, sugestões de CID, recomendação de exercícios ou comparação de medições. Tente perguntar: "resumo do Marcelo" ou "evolução da dor lombar".',
    },
  ]
}

export const composeGenUIResponse = wrapServerAction(
  {
    module: 'ai-genui',
    action: 'genui.compose',
    resourceType: 'assistant_messages',
  },
  async (input: z.infer<typeof ComposeInputSchema>, { session, setAuditResource }) => {
    const parsed = ComposeInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // 1. Sessão (cria se ausente)
    let sessionId = parsed.sessionId ?? null
    if (!sessionId) {
      const [row] = await db
        .insert(assistantSessions)
        .values({
          tenantId,
          userId: session.logifit.userId,
          persona: parsed.persona,
          title: parsed.prompt.slice(0, 60),
        })
        .returning({ id: assistantSessions.id })
      sessionId = row!.id
    } else {
      // valida ownership (regra 1 RLS já cobre, mas check explícito)
      const existing = await db
        .select({ id: assistantSessions.id })
        .from(assistantSessions)
        .where(and(eq(assistantSessions.id, sessionId), eq(assistantSessions.tenantId, tenantId)))
        .limit(1)
      if (existing.length === 0) {
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Sessão não encontrada',
          request_id: '',
        })
      }
    }

    // 2. Insert user message
    await db.insert(assistantMessages).values({
      tenantId,
      sessionId,
      role: 'user',
      content: parsed.prompt,
    })

    // 3. LLM stub gera blocos
    const blocks = stubLlmResponse({
      prompt: parsed.prompt,
      memberId: parsed.memberId ?? null,
      persona: parsed.persona,
    })

    // 4. Valida tool calls + monta resposta final
    const validatedBlocks: GenUIMessageBlock[] = []
    const auditCalls: Array<{ name: string; ok: boolean; reason?: string }> = []

    for (const b of blocks) {
      if (b.kind === 'text') {
        validatedBlocks.push(b)
        continue
      }
      const result = validateToolCall(b.call, { persona: parsed.persona })
      if (result.ok) {
        validatedBlocks.push({ kind: 'tool_call', call: { ...b.call, args: result.call.args } })
        auditCalls.push({ name: b.call.name, ok: true })
      } else {
        // Não exporta como kind='invalid' (não existe no schema); converte em texto
        validatedBlocks.push({
          kind: 'text',
          content: `[Componente ${b.call.name} bloqueado: ${result.reason}]`,
        })
        auditCalls.push({ name: b.call.name, ok: false, reason: result.reason })
      }
    }

    // 5. Insert assistant message com tool_calls jsonb
    const [assistantRow] = await db
      .insert(assistantMessages)
      .values({
        tenantId,
        sessionId,
        role: 'assistant',
        content: validatedBlocks
          .filter((b) => b.kind === 'text')
          .map((b) => (b as { content: string }).content)
          .join('\n\n'),
        toolCalls:
          auditCalls.length > 0
            ? auditCalls.map((c) => ({
                name: c.name,
                ok: c.ok,
                reason: c.reason ?? null,
                at: new Date().toISOString(),
              }))
            : null,
      })
      .returning({ id: assistantMessages.id })

    setAuditResource(assistantRow!.id, {
      session_id: sessionId,
      tool_calls_count: auditCalls.length,
      tool_calls_ok: auditCalls.filter((c) => c.ok).length,
      tool_calls_blocked: auditCalls.filter((c) => !c.ok).length,
    })

    const response: GenUIResponse = {
      sessionId,
      blocks: validatedBlocks,
    }
    return { ok: true as const, ...response }
  },
)
