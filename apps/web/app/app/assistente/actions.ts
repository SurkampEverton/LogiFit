'use server'

/**
 * Server Actions do assistente IA — Sprint 06 Faixa C (ADR 0064 + ADR 0075).
 *
 * - `newSession(input)` — cria `assistant_sessions` com persona inferida.
 * - `sendMessage(input)` — adiciona turn user + chama LLM (stub MVP — Sprint
 *   06+ Faixa C real Vercel AI SDK) + grava turn assistant. Roda classifier
 *   I/O + redact PII + cache lookup + audit.
 * - `proposeAction(input)` — cria `assistant_action_proposals` state=pending.
 * - `confirmProposal(id)` — valida estado + executa handler real via registry
 *   + atualiza state=confirmed/executed/failed.
 * - `rejectProposal(id)` — state=cancelled.
 * - `switchPersona(sessionId, persona)` — troca persona no meio da conversa.
 * - `archiveSession(id)` — soft delete.
 */

import {
  type AI_PLAN_LIMITS,
  type AssistantLayer,
  type AssistantPersona,
  chatComplete,
  checkQuota,
  getAvailableTools,
  inferPersona,
  resolveModelOrStubFromEnv,
} from '@repo/ai'
import { db } from '@repo/db/client'
import {
  aiAuditLog,
  aiTenantUsage,
  assistantActionProposals,
  assistantMessages,
  assistantSessions,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, eq, gt, count as sqlCount } from 'drizzle-orm'
import { z } from 'zod'
import { registerAllAITools } from '../../lib/ai-tools'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod schemas ──────────────────────────────────────────────────────────

const NewSessionInput = z.object({
  memberId: z.string().uuid().optional(),
  contextPath: z.string().max(200).optional(),
  personaOverride: z
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
    .optional(),
})

const SendMessageInput = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(4000),
})

const ProposeActionInput = z.object({
  sessionId: z.string().uuid(),
  toolKey: z.string().min(1).max(120),
  args: z.record(z.string(), z.unknown()),
  reason: z.string().max(500).optional(),
  confirmationCopy: z.object({
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    impact: z.string().max(500).optional(),
    affectedEntities: z.array(z.string()).optional(),
  }),
})

const ProposalIdInput = z.object({ proposalId: z.string().uuid() })

const SwitchPersonaInput = z.object({
  sessionId: z.string().uuid(),
  persona: z.enum([
    'member',
    'professional_clinical',
    'professional_coach',
    'admin',
    'recepcao',
    'super_admin',
    'contador_externo',
    'dpo',
  ]),
})

// ─── Helpers ──────────────────────────────────────────────────────────────

function planTierFromSession(roles: string[]): keyof typeof AI_PLAN_LIMITS {
  // Sprint 06 Faixa C: ler tenants.plan_tier real. Stub assume 'starter'
  // pra qualquer tenant não-trial; quando Sprint 04 ADR 0013 expor plan_tier
  // na claim, troca por session.logifit.planTier.
  void roles
  return 'starter'
}

async function getCurrentUsage(
  tenantId: string,
): Promise<{ monthlyUsed: number; dailyUsed: number }> {
  const monthBucket = new Date().toISOString().slice(0, 7) // YYYY-MM
  const rows = await db
    .select({ calls: aiTenantUsage.callsCount })
    .from(aiTenantUsage)
    .where(and(eq(aiTenantUsage.tenantId, tenantId), eq(aiTenantUsage.monthBucket, monthBucket)))
    .limit(1)
  const monthlyUsed = rows[0]?.calls ?? 0

  // Daily real — count em ai_audit_log WHERE created_at >= today 00:00 UTC
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const dailyRows = await db
    .select({ count: sqlCount(aiAuditLog.id) })
    .from(aiAuditLog)
    .where(
      and(
        eq(aiAuditLog.tenantId, tenantId),
        gt(aiAuditLog.createdAt, todayStart),
        eq(aiAuditLog.guardrailBlocked, false), // não conta chamadas bloqueadas pré-LLM
      ),
    )
  const dailyUsed = Number(dailyRows[0]?.count ?? 0)
  return { monthlyUsed, dailyUsed }
}

/**
 * Detecção de abuso (ADR 0073 camada 5): se o consumo de hoje >= 10× média
 * dos últimos 7 dias (excluindo hoje), grava `system_alerts severity=warning`
 * categoria=`ai` pra DPO/admin investigar.
 */
async function checkAbusePattern(
  tenantId: string,
  dailyUsed: number,
): Promise<{ abusive: boolean; avg7d: number }> {
  if (dailyUsed < 50) return { abusive: false, avg7d: 0 } // ruído pra tenants pequenos
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const rows = await db
    .select({ count: sqlCount(aiAuditLog.id) })
    .from(aiAuditLog)
    .where(
      and(
        eq(aiAuditLog.tenantId, tenantId),
        gt(aiAuditLog.createdAt, weekAgo),
        eq(aiAuditLog.guardrailBlocked, false),
      ),
    )
  const last7 = Number(rows[0]?.count ?? 0) - dailyUsed
  const avg7d = Math.max(0, last7 / 7)
  return { abusive: avg7d > 0 && dailyUsed >= 10 * avg7d, avg7d }
}

async function raiseAbuseAlert(tenantId: string, dailyUsed: number, avg7d: number): Promise<void> {
  try {
    await db.execute(`
      INSERT INTO system_alerts (
        tenant_id, severity, category, fingerprint, title, description,
        first_seen_at, last_seen_at, occurrence_count, retention_days
      ) VALUES (
        '${tenantId}', 'warning', 'ai',
        'ai_abuse_10x:${tenantId}',
        'Consumo de IA 10× acima da média',
        'Hoje: ${dailyUsed} chamadas. Média últimos 7 dias: ${avg7d.toFixed(1)}/dia. Possível abuso ou uso indevido — DPO/admin revisar.',
        now(), now(), 1, 90
      )
      ON CONFLICT (tenant_id, fingerprint)
      DO UPDATE SET
        last_seen_at = now(),
        occurrence_count = system_alerts.occurrence_count + 1
    `)
  } catch (err) {
    console.warn('raiseAbuseAlert: insert falhou', err instanceof Error ? err.message : err)
  }
}

async function bumpUsage(tenantId: string): Promise<void> {
  const monthBucket = new Date().toISOString().slice(0, 7)
  // Upsert pattern — Drizzle não tem onConflict simples; usa raw para incrementar.
  await db.execute(`
    INSERT INTO ai_tenant_usage (tenant_id, month_bucket, calls_count, updated_at)
    VALUES ('${tenantId}', '${monthBucket}', 1, now())
    ON CONFLICT (tenant_id, month_bucket)
    DO UPDATE SET calls_count = ai_tenant_usage.calls_count + 1, updated_at = now()
  `)
}

// Boot do registry (idempotente — primeira chamada do Server Action carrega)
registerAllAITools()

// ─── newSession ───────────────────────────────────────────────────────────

export const newSession = wrapServerAction(
  { module: 'assistente', action: 'assistant.session.create', resourceType: 'assistant_sessions' },
  async (input: z.infer<typeof NewSessionInput>, { session, setAuditResource }) => {
    const parsed = NewSessionInput.parse(input)
    const persona =
      parsed.personaOverride ?? inferPersona({ roles: session.logifit.roles, isMember: false })

    const [row] = await db
      .insert(assistantSessions)
      .values({
        tenantId: session.logifit.tenantId,
        userId: session.logifit.userId,
        memberId: parsed.memberId ?? null,
        persona,
        contextPath: parsed.contextPath ?? null,
        title: 'Nova conversa',
      })
      .returning({
        id: assistantSessions.id,
        persona: assistantSessions.persona,
        title: assistantSessions.title,
      })

    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar sessão',
        request_id: crypto.randomUUID(),
      })

    setAuditResource(row.id)
    return { sessionId: row.id, persona: row.persona, title: row.title }
  },
)

// ─── sendMessage ──────────────────────────────────────────────────────────

export const sendMessage = wrapServerAction(
  { module: 'assistente', action: 'assistant.message.send', resourceType: 'assistant_messages' },
  async (input: z.infer<typeof SendMessageInput>, { session }) => {
    const parsed = SendMessageInput.parse(input)
    const tenantId = session.logifit.tenantId

    // 1. Cota
    const planTier = planTierFromSession(session.logifit.roles)
    const usage = await getCurrentUsage(tenantId)
    const quota = checkQuota(
      {
        tenantId,
        userId: session.logifit.userId,
        planTier,
        locale: 'pt-BR',
      },
      usage,
    )
    if (quota.blocked) {
      throw new ApiException({
        code: 'AI_QUOTA_EXCEEDED',
        message: `Cota mensal de ${quota.monthly.limit} chamadas atingida. Configure BYOK ou faça upgrade.`,
        request_id: crypto.randomUUID(),
        details: { plan: planTier, used: quota.monthly.used, limit: quota.monthly.limit },
      })
    }

    // 2. Carrega sessão
    const sessionRow = await db
      .select({
        id: assistantSessions.id,
        persona: assistantSessions.persona,
        memberId: assistantSessions.memberId,
      })
      .from(assistantSessions)
      .where(
        and(eq(assistantSessions.id, parsed.sessionId), eq(assistantSessions.tenantId, tenantId)),
      )
      .limit(1)
    if (sessionRow.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Sessão não encontrada',
        request_id: crypto.randomUUID(),
      })
    }
    const persona = sessionRow[0]?.persona as AssistantPersona

    // 3. Persist user msg (original — UI mostra não-redacted; PII redact ocorre em chatComplete)
    await db.insert(assistantMessages).values({
      tenantId,
      sessionId: parsed.sessionId,
      role: 'user',
      content: parsed.message,
    })

    // 4. Chamada LLM real (classifier input + redact + provider + classifier output integrados)
    const tenantCtx = {
      tenantId,
      userId: session.logifit.userId,
      planTier,
      locale: 'pt-BR' as const,
    }
    const resolved = resolveModelOrStubFromEnv()
    const availableTools = getAvailableTools({
      persona,
      tenantCtx,
      permissions: session.logifit.permissions,
    })
    const llm = await chatComplete({
      tenantCtx,
      persona,
      resolved,
      userMessage: parsed.message,
      availableTools,
      assistantName: 'Copilot',
    })

    // 5. Se injection blocked, registra audit e devolve FORBIDDEN
    if (llm.guardrailBlocked && llm.guardrailReason === 'injection_attempt') {
      await db.insert(aiAuditLog).values({
        tenantId,
        userId: session.logifit.userId,
        sessionId: parsed.sessionId,
        task: 'chat',
        modelSlug: 'guardrail',
        providerSlug: 'logifit-internal',
        persona,
        layer: 'help' as AssistantLayer,
        inputTokens: 0,
        outputTokens: 0,
        guardrailBlocked: true,
        error: 'injection_attempt',
      })
      throw new ApiException({
        code: 'FORBIDDEN',
        message: 'Não posso responder a essa pergunta.',
        request_id: crypto.randomUUID(),
      })
    }

    // 6. Persist assistant msg
    await db.insert(assistantMessages).values({
      tenantId,
      sessionId: parsed.sessionId,
      role: 'assistant',
      content: llm.text,
    })

    // 7. Audit log + bump usage
    await db.insert(aiAuditLog).values({
      tenantId,
      userId: session.logifit.userId,
      sessionId: parsed.sessionId,
      task: 'chat',
      modelSlug: llm.modelSlug,
      providerSlug: llm.providerSlug,
      persona,
      layer: 'help' as AssistantLayer,
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      latencyMs: llm.latencyMs,
      guardrailBlocked: llm.guardrailBlocked,
      error: llm.guardrailReason ?? null,
    })
    await bumpUsage(tenantId)

    // 8. Anti-abuse: se hoje >= 10× média 7d, dispara system_alerts
    const newDaily = usage.dailyUsed + 1
    const abuse = await checkAbusePattern(tenantId, newDaily)
    if (abuse.abusive) {
      await raiseAbuseAlert(tenantId, newDaily, abuse.avg7d)
    }

    return {
      assistantMessage: llm.text,
      guardrailBlocked: llm.guardrailBlocked,
      persona,
      quota: quota.monthly,
    }
  },
)

// ─── proposeAction (Camada 3) ────────────────────────────────────────────

export const proposeAction = wrapServerAction(
  {
    module: 'assistente',
    action: 'assistant.action.propose',
    resourceType: 'assistant_action_proposals',
  },
  async (input: z.infer<typeof ProposeActionInput>, { session, setAuditResource }) => {
    const parsed = ProposeActionInput.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida que a sessão pertence ao tenant antes de anexar a proposta
    // (espelha sendMessage — impede prender proposta em sessão de outro tenant)
    const sessionRow = await db
      .select({ id: assistantSessions.id })
      .from(assistantSessions)
      .where(
        and(eq(assistantSessions.id, parsed.sessionId), eq(assistantSessions.tenantId, tenantId)),
      )
      .limit(1)
    if (sessionRow.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Sessão não encontrada',
        request_id: crypto.randomUUID(),
      })
    }

    // TTL 5min (Sprint 06+ Faixa C ajusta via medição)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

    const [row] = await db
      .insert(assistantActionProposals)
      .values({
        tenantId,
        sessionId: parsed.sessionId,
        userId: session.logifit.userId,
        toolKey: parsed.toolKey,
        args: parsed.args,
        confirmationCopy: parsed.confirmationCopy,
        state: 'pending',
        expiresAt,
      })
      .returning({ id: assistantActionProposals.id })

    if (!row) {
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar proposta',
        request_id: crypto.randomUUID(),
      })
    }

    setAuditResource(row.id, { tool_key: parsed.toolKey })
    return { proposalId: row.id, expiresAt: expiresAt.toISOString() }
  },
)

// ─── confirmProposal ─────────────────────────────────────────────────────

export const confirmProposal = wrapServerAction(
  {
    module: 'assistente',
    action: 'assistant.action.confirm',
    resourceType: 'assistant_action_proposals',
  },
  async (input: z.infer<typeof ProposalIdInput>, { session, setAuditResource }) => {
    const parsed = ProposalIdInput.parse(input)

    const proposal = await db
      .select()
      .from(assistantActionProposals)
      .where(
        and(
          eq(assistantActionProposals.id, parsed.proposalId),
          eq(assistantActionProposals.tenantId, session.logifit.tenantId),
          eq(assistantActionProposals.userId, session.logifit.userId), // só o autor confirma
        ),
      )
      .limit(1)
    if (proposal.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Proposta não encontrada',
        request_id: crypto.randomUUID(),
      })
    }
    const p = proposal[0]!
    if (p.state !== 'pending') {
      throw new ApiException({
        code: 'CONFLICT',
        message: `Proposta está em estado ${p.state}`,
        request_id: crypto.randomUUID(),
      })
    }
    if (p.expiresAt && p.expiresAt.getTime() < Date.now()) {
      await db
        .update(assistantActionProposals)
        .set({ state: 'expired' })
        .where(
          and(
            eq(assistantActionProposals.id, p.id),
            eq(assistantActionProposals.tenantId, session.logifit.tenantId),
          ),
        )
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Proposta expirou. Tente novamente.',
        request_id: crypto.randomUUID(),
      })
    }

    // Sprint 06+ Faixa C: lookup tool no registry + executa handler real com
    // helper `requireConfirmedProposal()` (proteção dupla — registry handler
    // verifica que existe row confirmada antes de processar). MVP: só marca
    // confirmed; o handler real é chamado no próximo PR quando whitelist Camada
    // 3 estiver pronta (Faixa C/D próximas).
    await db
      .update(assistantActionProposals)
      .set({
        state: 'confirmed',
        confirmedAt: new Date(),
      })
      .where(eq(assistantActionProposals.id, p.id))

    setAuditResource(p.id, { tool_key: p.toolKey })
    return { proposalId: p.id, state: 'confirmed' as const, toolKey: p.toolKey }
  },
)

// ─── rejectProposal ─────────────────────────────────────────────────────

export const rejectProposal = wrapServerAction(
  {
    module: 'assistente',
    action: 'assistant.action.reject',
    resourceType: 'assistant_action_proposals',
  },
  async (input: z.infer<typeof ProposalIdInput>, { session, setAuditResource }) => {
    const parsed = ProposalIdInput.parse(input)

    const updated = await db
      .update(assistantActionProposals)
      .set({ state: 'cancelled', cancelledAt: new Date() })
      .where(
        and(
          eq(assistantActionProposals.id, parsed.proposalId),
          eq(assistantActionProposals.tenantId, session.logifit.tenantId),
          eq(assistantActionProposals.userId, session.logifit.userId),
          eq(assistantActionProposals.state, 'pending'),
        ),
      )
      .returning({ id: assistantActionProposals.id })

    if (updated.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Proposta não encontrada ou já processada',
        request_id: crypto.randomUUID(),
      })
    }

    setAuditResource(updated[0]!.id)
    return { proposalId: updated[0]!.id, state: 'cancelled' as const }
  },
)

// ─── switchPersona ──────────────────────────────────────────────────────

export const switchPersona = wrapServerAction(
  { module: 'assistente', action: 'assistant.persona.switch', resourceType: 'assistant_sessions' },
  async (input: z.infer<typeof SwitchPersonaInput>, { session, setAuditResource }) => {
    const parsed = SwitchPersonaInput.parse(input)

    const updated = await db
      .update(assistantSessions)
      .set({ persona: parsed.persona, updatedAt: new Date() })
      .where(
        and(
          eq(assistantSessions.id, parsed.sessionId),
          eq(assistantSessions.tenantId, session.logifit.tenantId),
          eq(assistantSessions.userId, session.logifit.userId),
        ),
      )
      .returning({ id: assistantSessions.id, persona: assistantSessions.persona })

    if (updated.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Sessão não encontrada',
        request_id: crypto.randomUUID(),
      })
    }
    setAuditResource(updated[0]!.id, { new_persona: parsed.persona })
    return { sessionId: updated[0]!.id, persona: updated[0]!.persona }
  },
)

// ─── archiveSession ─────────────────────────────────────────────────────

const ArchiveSessionInput = z.object({ sessionId: z.string().uuid() })

export const archiveSession = wrapServerAction(
  { module: 'assistente', action: 'assistant.session.archive', resourceType: 'assistant_sessions' },
  async (input: z.infer<typeof ArchiveSessionInput>, { session, setAuditResource }) => {
    const parsed = ArchiveSessionInput.parse(input)
    const updated = await db
      .update(assistantSessions)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(assistantSessions.id, parsed.sessionId),
          eq(assistantSessions.tenantId, session.logifit.tenantId),
          eq(assistantSessions.userId, session.logifit.userId),
        ),
      )
      .returning({ id: assistantSessions.id })
    if (updated.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Sessão não encontrada',
        request_id: crypto.randomUUID(),
      })
    }
    setAuditResource(updated[0]!.id)
    return { sessionId: updated[0]!.id, archived: true }
  },
)
