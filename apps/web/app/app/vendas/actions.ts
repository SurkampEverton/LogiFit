'use server'

/**
 * Server Actions de funil de vendas — Sprint 10 Faixa B (ADR 0022 esperado).
 *
 * MVP:
 *   - createLead — captura inicial (quick_* OU person_id)
 *   - moveLeadToStage — atomic: UPDATE leads.stageId + INSERT lead_events
 *   - archiveLead — soft-delete + motivo (lost)
 *   - createProposal — versionada (calcula version automaticamente)
 *   - convertLeadToMember — atomic: requer person_id, cria member (mesmo
 *     person_id), opcional contrato a partir da proposta, arquiva lead
 *   - listLeads — lista por estágio (kanban board) ou tabular com filtros
 *   - listLeadStages — lookup pra dropdowns + kanban columns
 *
 * Faixas C/D adiadas pra próximo PR: scheduleTrialClass, acceptProposal,
 * upgradeLeadToPerson (já contemplado parcialmente via createLead com personId).
 *
 * Regras consumidas:
 *   - regra 7 (Zod validation no boundary)
 *   - regra 33 (wrapServerAction → envelope ADR 0071 + audit_log)
 *   - regra 42 (member criado no mesmo tenant — sem cross-tenant aqui)
 *   - regra 24 (member = aluno/paciente; mesmo person_id sem duplicação)
 */

import { db } from '@repo/db/client'
import {
  contracts,
  leadEvents,
  leadStages,
  leads,
  memberEvents,
  members,
  proposals,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod schemas ──────────────────────────────────────────────────────────

const CreateLeadInputSchema = z
  .object({
    companyId: z.string().uuid(),
    unitId: z.string().uuid().optional(),
    stageId: z.string().uuid().optional(), // default: 1º stage active do tenant
    personId: z.string().uuid().optional(),
    quickName: z.string().min(2).max(120).optional(),
    quickPhone: z.string().min(8).max(20).optional(),
    quickEmail: z.string().email().optional(),
    assignedToUserId: z.string().uuid().optional(),
    source: z
      .enum([
        'website',
        'instagram',
        'referral',
        'walk_in',
        'panfleto',
        'gympass',
        'totalpass',
        'outdoor',
        'other',
      ])
      .default('other'),
    sourceRef: z.string().uuid().optional(),
    interest: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (v) => v.personId || v.quickName || v.quickPhone,
    'Lead exige person_id OU quick_name OU quick_phone (mínimo contato)',
  )

const MoveLeadToStageInputSchema = z.object({
  leadId: z.string().uuid(),
  toStageId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})

const ArchiveLeadInputSchema = z.object({
  leadId: z.string().uuid(),
  reason: z.string().min(2).max(500),
})

const CreateProposalInputSchema = z
  .object({
    leadId: z.string().uuid(),
    planId: z.string().uuid().optional(),
    bundlePlanId: z.string().uuid().optional(),
    priceCents: z.number().int().nonnegative(),
    discountCents: z.number().int().nonnegative().default(0),
    validUntil: z.string().datetime(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (v) => v.discountCents < v.priceCents,
    'discount_cents deve ser menor que price_cents',
  )
  .refine(
    (v) => !(v.planId && v.bundlePlanId),
    'plan_id e bundle_plan_id são mutuamente exclusivos',
  )

const ConvertLeadToMemberInputSchema = z.object({
  leadId: z.string().uuid(),
  proposalId: z.string().uuid().optional(),
  // Quando proposal tem plan, opcional gerar contract com este billingDay
  billingDay: z.number().int().min(1).max(28).default(10),
})

const ListLeadsInputSchema = z.object({
  stageId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(100),
})

// ─── createLead ───────────────────────────────────────────────────────────

export const createLead = wrapServerAction(
  { module: 'vendas', action: 'lead.create', resourceType: 'leads' },
  async (
    input: z.infer<typeof CreateLeadInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = CreateLeadInputSchema.parse(input)

    // Resolve stage default (1º active asc por orderIdx) se não informado
    let stageId = parsed.stageId
    if (!stageId) {
      const [defaultStage] = await db
        .select({ id: leadStages.id })
        .from(leadStages)
        .where(
          and(
            eq(leadStages.tenantId, session.logifit.tenantId),
            eq(leadStages.active, true),
          ),
        )
        .orderBy(asc(leadStages.orderIdx))
        .limit(1)
      if (!defaultStage)
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message:
            'Nenhum estágio de funil cadastrado pra este tenant. Configure em /app/vendas/funil/configurar.',
          request_id: '',
        })
      stageId = defaultStage.id
    }

    const [row] = await db
      .insert(leads)
      .values({
        tenantId: session.logifit.tenantId,
        companyId: parsed.companyId,
        unitId: parsed.unitId ?? null,
        stageId,
        personId: parsed.personId ?? null,
        quickName: parsed.quickName ?? null,
        quickPhone: parsed.quickPhone ?? null,
        quickEmail: parsed.quickEmail ?? null,
        assignedToUserId: parsed.assignedToUserId ?? null,
        source: parsed.source,
        sourceRef: parsed.sourceRef ?? null,
        interest: parsed.interest ?? null,
        notes: parsed.notes ?? null,
      })
      .returning({ id: leads.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar lead',
        request_id: '',
      })

    setAuditResource(row.id, { source: parsed.source })

    // Evento inicial de criação
    await db.insert(leadEvents).values({
      tenantId: session.logifit.tenantId,
      leadId: row.id,
      kind: 'lead.created',
      toStageId: stageId,
      actorUserId: session.logifit.userId,
    })

    return { id: row.id, stageId }
  },
)

// ─── moveLeadToStage ──────────────────────────────────────────────────────

export const moveLeadToStage = wrapServerAction(
  { module: 'vendas', action: 'lead.move_stage', resourceType: 'leads' },
  async (
    input: z.infer<typeof MoveLeadToStageInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = MoveLeadToStageInputSchema.parse(input)

    return await db.transaction(async (tx) => {
      const [lead] = await tx
        .select({ id: leads.id, stageId: leads.stageId })
        .from(leads)
        .where(
          and(
            eq(leads.id, parsed.leadId),
            eq(leads.tenantId, session.logifit.tenantId),
            isNull(leads.archivedAt),
          ),
        )
        .limit(1)
      if (!lead)
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Lead não encontrado ou arquivado',
          request_id: '',
        })
      if (lead.stageId === parsed.toStageId) {
        return { id: lead.id, unchanged: true }
      }

      // Garante stage destino existe + active + pertence ao tenant
      const [stage] = await tx
        .select({ id: leadStages.id, active: leadStages.active })
        .from(leadStages)
        .where(
          and(
            eq(leadStages.id, parsed.toStageId),
            eq(leadStages.tenantId, session.logifit.tenantId),
          ),
        )
        .limit(1)
      if (!stage)
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Estágio destino inválido',
          request_id: '',
        })
      if (!stage.active)
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Estágio destino está inativo',
          request_id: '',
        })

      await tx
        .update(leads)
        .set({ stageId: parsed.toStageId, updatedAt: new Date() })
        .where(eq(leads.id, parsed.leadId))

      await tx.insert(leadEvents).values({
        tenantId: session.logifit.tenantId,
        leadId: parsed.leadId,
        kind: 'stage_changed',
        fromStageId: lead.stageId,
        toStageId: parsed.toStageId,
        payload: parsed.reason ?? null,
        actorUserId: session.logifit.userId,
      })

      setAuditResource(parsed.leadId, {
        from_stage: lead.stageId,
        to_stage: parsed.toStageId,
      })

      return { id: parsed.leadId, unchanged: false }
    })
  },
)

// ─── archiveLead ──────────────────────────────────────────────────────────

export const archiveLead = wrapServerAction(
  { module: 'vendas', action: 'lead.archive', resourceType: 'leads' },
  async (
    input: z.infer<typeof ArchiveLeadInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ArchiveLeadInputSchema.parse(input)
    const [row] = await db
      .update(leads)
      .set({
        archivedAt: new Date(),
        lostReason: parsed.reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leads.id, parsed.leadId),
          eq(leads.tenantId, session.logifit.tenantId),
          isNull(leads.archivedAt),
        ),
      )
      .returning({ id: leads.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Lead não encontrado ou já arquivado',
        request_id: '',
      })

    await db.insert(leadEvents).values({
      tenantId: session.logifit.tenantId,
      leadId: parsed.leadId,
      kind: 'lead.archived',
      payload: parsed.reason,
      actorUserId: session.logifit.userId,
    })

    setAuditResource(row.id, { reason: parsed.reason })
    return { id: row.id }
  },
)

// ─── createProposal ───────────────────────────────────────────────────────

export const createProposal = wrapServerAction(
  { module: 'vendas', action: 'proposal.create', resourceType: 'proposals' },
  async (
    input: z.infer<typeof CreateProposalInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = CreateProposalInputSchema.parse(input)

    // Garante lead pertence ao tenant + não arquivado
    const [lead] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          eq(leads.id, parsed.leadId),
          eq(leads.tenantId, session.logifit.tenantId),
          isNull(leads.archivedAt),
        ),
      )
      .limit(1)
    if (!lead)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Lead não encontrado ou arquivado',
        request_id: '',
      })

    // Versão = max(version) + 1 deste lead (versionamento por lead)
    const [maxVersion] = await db
      .select({ v: sql<number>`coalesce(max(${proposals.version}), 0)` })
      .from(proposals)
      .where(
        and(
          eq(proposals.leadId, parsed.leadId),
          eq(proposals.tenantId, session.logifit.tenantId),
        ),
      )
    const nextVersion = (maxVersion?.v ?? 0) + 1

    const [row] = await db
      .insert(proposals)
      .values({
        tenantId: session.logifit.tenantId,
        leadId: parsed.leadId,
        planId: parsed.planId ?? null,
        bundlePlanId: parsed.bundlePlanId ?? null,
        priceCents: parsed.priceCents,
        discountCents: parsed.discountCents,
        validUntil: new Date(parsed.validUntil),
        version: nextVersion,
        notes: parsed.notes ?? null,
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: proposals.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar proposta',
        request_id: '',
      })

    await db.insert(leadEvents).values({
      tenantId: session.logifit.tenantId,
      leadId: parsed.leadId,
      kind: 'proposal.created',
      payload: JSON.stringify({
        proposalId: row.id,
        version: nextVersion,
        priceCents: parsed.priceCents,
        discountCents: parsed.discountCents,
      }),
      actorUserId: session.logifit.userId,
    })

    setAuditResource(row.id, { lead_id: parsed.leadId, version: nextVersion })
    return { id: row.id, version: nextVersion }
  },
)

// ─── convertLeadToMember ──────────────────────────────────────────────────
// Atomic transaction:
//   1. Lê lead — exige person_id (não permite quick_*)
//   2. Cria member (mesmo person_id) — unique (tenant, person) garante idempotência
//   3. Se proposalId + planId: cria contract status='active'
//   4. Insere member_events 'member.created'
//   5. Marca lead como converted_to_member_id + archived
//   6. Insere lead_events 'lead.converted'

export const convertLeadToMember = wrapServerAction(
  {
    module: 'vendas',
    action: 'lead.convert_to_member',
    resourceType: 'leads',
  },
  async (
    input: z.infer<typeof ConvertLeadToMemberInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ConvertLeadToMemberInputSchema.parse(input)

    return await db.transaction(async (tx) => {
      const [lead] = await tx
        .select({
          id: leads.id,
          personId: leads.personId,
          companyId: leads.companyId,
          unitId: leads.unitId,
          archivedAt: leads.archivedAt,
          convertedToMemberId: leads.convertedToMemberId,
        })
        .from(leads)
        .where(
          and(
            eq(leads.id, parsed.leadId),
            eq(leads.tenantId, session.logifit.tenantId),
          ),
        )
        .limit(1)
      if (!lead)
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Lead não encontrado',
          request_id: '',
        })
      if (lead.convertedToMemberId)
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Lead já convertido',
          request_id: '',
        })
      if (!lead.personId)
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message:
            'Lead exige person_id pra conversão. Use upgradeLeadToPerson primeiro.',
          request_id: '',
        })

      // Cria member com mesmo person_id (idempotente via unique tenant+person)
      const [member] = await tx
        .insert(members)
        .values({
          tenantId: session.logifit.tenantId,
          personId: lead.personId,
          companyId: lead.companyId,
          homeUnitId: lead.unitId,
        })
        .onConflictDoNothing({
          target: [members.tenantId, members.personId],
        })
        .returning({ id: members.id })

      // Se conflict (já era member nesse tenant), busca o existente
      let memberId: string
      if (member) {
        memberId = member.id
      } else {
        const [existing] = await tx
          .select({ id: members.id })
          .from(members)
          .where(
            and(
              eq(members.tenantId, session.logifit.tenantId),
              eq(members.personId, lead.personId),
            ),
          )
          .limit(1)
        if (!existing)
          throw new ApiException({
            code: 'INTERNAL_ERROR',
            message: 'Member não encontrado após conflict — race condition',
            request_id: '',
          })
        memberId = existing.id
      }

      // Member event (regra 5 — append-only)
      await tx.insert(memberEvents).values({
        tenantId: session.logifit.tenantId,
        memberId,
        actorUserId: session.logifit.userId,
        kind: 'member.created',
        payload: { source: 'lead_conversion', leadId: lead.id },
      })

      // Se proposal informada com plan_id, cria contract status='active'
      let contractId: string | null = null
      if (parsed.proposalId) {
        const [proposal] = await tx
          .select({
            id: proposals.id,
            planId: proposals.planId,
            status: proposals.status,
          })
          .from(proposals)
          .where(
            and(
              eq(proposals.id, parsed.proposalId),
              eq(proposals.tenantId, session.logifit.tenantId),
              eq(proposals.leadId, lead.id),
            ),
          )
          .limit(1)
        if (!proposal)
          throw new ApiException({
            code: 'NOT_FOUND',
            message: 'Proposta não encontrada para este lead',
            request_id: '',
          })

        if (proposal.planId) {
          const [c] = await tx
            .insert(contracts)
            .values({
              tenantId: session.logifit.tenantId,
              companyId: lead.companyId,
              memberId,
              planId: proposal.planId,
              startedAt: new Date(),
              billingDay: parsed.billingDay,
              status: 'active',
            })
            .returning({ id: contracts.id })
          contractId = c?.id ?? null

          // Marca proposta como accepted + linka contract criado
          await tx
            .update(proposals)
            .set({
              status: 'accepted',
              acceptedAt: new Date(),
              convertedContractId: contractId,
              updatedAt: new Date(),
            })
            .where(eq(proposals.id, parsed.proposalId))
        }
      }

      // Marca lead como convertido + archived
      await tx
        .update(leads)
        .set({
          convertedToMemberId: memberId,
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(leads.id, lead.id))

      await tx.insert(leadEvents).values({
        tenantId: session.logifit.tenantId,
        leadId: lead.id,
        kind: 'lead.converted',
        payload: JSON.stringify({ memberId, contractId }),
        actorUserId: session.logifit.userId,
      })

      setAuditResource(lead.id, { member_id: memberId, contract_id: contractId })
      return { leadId: lead.id, memberId, contractId }
    })
  },
)

// ─── listLeads (kanban / tabular) ─────────────────────────────────────────

export const listLeads = wrapServerAction(
  { module: 'vendas', action: 'lead.list' },
  async (input: z.infer<typeof ListLeadsInputSchema>, { session }) => {
    const parsed = ListLeadsInputSchema.parse(input)
    const conditions = [
      eq(leads.tenantId, session.logifit.tenantId),
      isNull(leads.archivedAt),
    ]
    if (parsed.stageId) conditions.push(eq(leads.stageId, parsed.stageId))
    if (parsed.assignedToUserId)
      conditions.push(eq(leads.assignedToUserId, parsed.assignedToUserId))

    const rows = await db
      .select({
        id: leads.id,
        stageId: leads.stageId,
        quickName: leads.quickName,
        quickPhone: leads.quickPhone,
        quickEmail: leads.quickEmail,
        personId: leads.personId,
        source: leads.source,
        interest: leads.interest,
        assignedToUserId: leads.assignedToUserId,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt))
      .limit(parsed.limit)

    return { rows }
  },
)

// ─── listLeadStages (lookup kanban columns) ───────────────────────────────

export const listLeadStages = wrapServerAction(
  { module: 'vendas', action: 'lead_stage.list' },
  async (_input: undefined, { session }) => {
    const rows = await db
      .select({
        id: leadStages.id,
        slug: leadStages.slug,
        name: leadStages.name,
        orderIdx: leadStages.orderIdx,
        kind: leadStages.kind,
        color: leadStages.color,
      })
      .from(leadStages)
      .where(
        and(
          eq(leadStages.tenantId, session.logifit.tenantId),
          eq(leadStages.active, true),
        ),
      )
      .orderBy(asc(leadStages.orderIdx))

    return { rows }
  },
)
