'use server'

/**
 * Server Actions de mensagens — Sprint 13 Faixa B (ADR 0025 + ADR 0026).
 *
 * MVP:
 *   - createTemplate / listTemplates / approveTemplate
 *   - createRegua (com validação Zod do DSL) / activateRegua / pauseRegua / listReguas
 *   - sendMessageManual — envio direto sem régua (audit gravado)
 *   - listMessages — histórico do tenant com filtros
 *   - listMemberMessages — widget perfil
 *
 * **Envio real WhatsApp/Email** adiado pra Sprint 13b — depende POC provider
 * + Resend integration. MVP grava `messages_sent` com `status='queued'` +
 * marker `provider='stub'` quando enviado via UI; integração com adapter real
 * fica próximo PR.
 *
 * Régua evaluator (cron tick consumindo domain_events + enfileira steps)
 * adiado Sprint 13b — schema + DSL prontos pra serem consumidos.
 *
 * Regras consumidas:
 *   - regra 7 (Zod validation boundary)
 *   - regra 33 (envelope ADR 0071 + audit_log)
 *   - regra 37 (safeFetch wrappers nos providers — implementação adiada)
 */

import { db } from '@repo/db/client'
import {
  extractTemplateVariables,
  renderTemplate,
  ReguaDslSchema,
} from '@repo/db/mensagens'
import {
  members,
  messageTemplates,
  messagesSent,
  persons,
  reguas,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const CreateTemplateInputSchema = z.object({
  channel: z.enum(['whatsapp', 'email', 'sms']),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9_]+$/, 'Slug aceita só [a-z0-9_]'),
  name: z.string().min(2).max(120),
  subject: z.string().max(200).optional(),
  body: z.string().min(2).max(4000),
})

const ApproveTemplateInputSchema = z.object({
  templateId: z.string().uuid(),
  providerTemplateId: z.string().min(1).max(120).optional(),
})

const CreateReguaInputSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  dsl: ReguaDslSchema,
})

const ToggleReguaInputSchema = z.object({
  reguaId: z.string().uuid(),
})

const SendMessageManualInputSchema = z.object({
  memberId: z.string().uuid(),
  templateId: z.string().uuid(),
  channel: z.enum(['whatsapp', 'email', 'sms']),
  variables: z.record(z.union([z.string(), z.number()])).default({}),
})

const ListMessagesInputSchema = z.object({
  channel: z.enum(['whatsapp', 'email', 'sms']).optional(),
  status: z.enum(['queued', 'sending', 'sent', 'delivered', 'read', 'failed']).optional(),
  limit: z.number().int().min(1).max(200).default(50),
})

const ListMemberMessagesInputSchema = z.object({
  memberId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(10),
})

// ─── createTemplate ──────────────────────────────────────────────────────

export const createTemplate = wrapServerAction(
  { module: 'mensagens', action: 'template.create', resourceType: 'message_templates' },
  async (
    input: z.infer<typeof CreateTemplateInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = CreateTemplateInputSchema.parse(input)
    const variables = extractTemplateVariables(parsed.body)
    // Email exige subject; WhatsApp não
    if (parsed.channel === 'email' && !parsed.subject) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Email exige subject',
        request_id: '',
      })
    }
    // Email passa direto pra approved (sem fluxo Meta)
    const initialApproval = parsed.channel === 'email' ? 'approved' : 'draft'

    const [row] = await db
      .insert(messageTemplates)
      .values({
        tenantId: session.logifit.tenantId,
        channel: parsed.channel,
        slug: parsed.slug,
        name: parsed.name,
        subject: parsed.subject ?? null,
        body: parsed.body,
        variables,
        approvalStatus: initialApproval,
        approvedAt: initialApproval === 'approved' ? new Date() : null,
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: messageTemplates.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar template',
        request_id: '',
      })
    setAuditResource(row.id, {
      slug: parsed.slug,
      channel: parsed.channel,
      variables_count: variables.length,
    })
    return { id: row.id, variables }
  },
)

// ─── approveTemplate (WhatsApp — após aprovação Meta) ────────────────────

export const approveTemplate = wrapServerAction(
  { module: 'mensagens', action: 'template.approve', resourceType: 'message_templates' },
  async (
    input: z.infer<typeof ApproveTemplateInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ApproveTemplateInputSchema.parse(input)
    const [row] = await db
      .update(messageTemplates)
      .set({
        approvalStatus: 'approved',
        approvedAt: new Date(),
        providerTemplateId: parsed.providerTemplateId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(messageTemplates.id, parsed.templateId),
          eq(messageTemplates.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: messageTemplates.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Template não encontrado',
        request_id: '',
      })
    setAuditResource(row.id, { provider_template_id: parsed.providerTemplateId })
    return { id: row.id }
  },
)

// ─── listTemplates ───────────────────────────────────────────────────────

export const listTemplates = wrapServerAction(
  { module: 'mensagens', action: 'template.list' },
  async (_input: undefined, { session }) => {
    const rows = await db
      .select({
        id: messageTemplates.id,
        slug: messageTemplates.slug,
        name: messageTemplates.name,
        channel: messageTemplates.channel,
        subject: messageTemplates.subject,
        body: messageTemplates.body,
        variables: messageTemplates.variables,
        approvalStatus: messageTemplates.approvalStatus,
        approvedAt: messageTemplates.approvedAt,
      })
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.tenantId, session.logifit.tenantId),
          isNull(messageTemplates.archivedAt),
        ),
      )
      .orderBy(desc(messageTemplates.createdAt))
    return { rows }
  },
)

// ─── createRegua ─────────────────────────────────────────────────────────

export const createRegua = wrapServerAction(
  { module: 'mensagens', action: 'regua.create', resourceType: 'reguas' },
  async (
    input: z.infer<typeof CreateReguaInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = CreateReguaInputSchema.parse(input)
    const [row] = await db
      .insert(reguas)
      .values({
        tenantId: session.logifit.tenantId,
        name: parsed.name,
        description: parsed.description ?? null,
        trigger: parsed.dsl.trigger,
        actions: parsed.dsl.actions,
        stopOn: parsed.dsl.stop_on ?? null,
        guards: parsed.dsl.guards ?? null,
        active: false,
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: reguas.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar régua',
        request_id: '',
      })
    setAuditResource(row.id, {
      name: parsed.name,
      trigger_event: parsed.dsl.trigger.event,
      actions_count: parsed.dsl.actions.length,
    })
    return { id: row.id }
  },
)

// ─── activateRegua / pauseRegua ──────────────────────────────────────────

async function toggleReguaActive(
  reguaId: string,
  tenantId: string,
  active: boolean,
): Promise<string> {
  const [row] = await db
    .update(reguas)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(reguas.id, reguaId), eq(reguas.tenantId, tenantId)))
    .returning({ id: reguas.id })
  if (!row)
    throw new ApiException({
      code: 'NOT_FOUND',
      message: 'Régua não encontrada',
      request_id: '',
    })
  return row.id
}

export const activateRegua = wrapServerAction(
  { module: 'mensagens', action: 'regua.activate', resourceType: 'reguas' },
  async (
    input: z.infer<typeof ToggleReguaInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ToggleReguaInputSchema.parse(input)
    const id = await toggleReguaActive(parsed.reguaId, session.logifit.tenantId, true)
    setAuditResource(id, { active: true })
    return { id }
  },
)

export const pauseRegua = wrapServerAction(
  { module: 'mensagens', action: 'regua.pause', resourceType: 'reguas' },
  async (
    input: z.infer<typeof ToggleReguaInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ToggleReguaInputSchema.parse(input)
    const id = await toggleReguaActive(parsed.reguaId, session.logifit.tenantId, false)
    setAuditResource(id, { active: false })
    return { id }
  },
)

// ─── listReguas ──────────────────────────────────────────────────────────

export const listReguas = wrapServerAction(
  { module: 'mensagens', action: 'regua.list' },
  async (_input: undefined, { session }) => {
    const rows = await db
      .select({
        id: reguas.id,
        name: reguas.name,
        description: reguas.description,
        trigger: reguas.trigger,
        actions: reguas.actions,
        active: reguas.active,
        runsCount: reguas.runsCount,
        lastRunAt: reguas.lastRunAt,
      })
      .from(reguas)
      .where(and(eq(reguas.tenantId, session.logifit.tenantId), isNull(reguas.archivedAt)))
      .orderBy(desc(reguas.createdAt))
    return { rows }
  },
)

// ─── sendMessageManual ───────────────────────────────────────────────────
/**
 * Envia mensagem manual a member (bypass de régua).
 *
 * **MVP**: cria `messages_sent` com `status='queued'` + `provider='stub'`;
 * envio real ao WhatsApp/Email fica adiado pra Sprint 13b quando POC do
 * provider concluir. Audit grava intent completa pra rastreabilidade.
 */
export const sendMessageManual = wrapServerAction(
  { module: 'mensagens', action: 'message.send_manual', resourceType: 'messages_sent' },
  async (
    input: z.infer<typeof SendMessageManualInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = SendMessageManualInputSchema.parse(input)

    // Resolve template + member
    const [t] = await db
      .select({
        id: messageTemplates.id,
        body: messageTemplates.body,
        subject: messageTemplates.subject,
        approvalStatus: messageTemplates.approvalStatus,
      })
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.id, parsed.templateId),
          eq(messageTemplates.tenantId, session.logifit.tenantId),
          eq(messageTemplates.channel, parsed.channel),
        ),
      )
      .limit(1)
    if (!t)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Template não encontrado',
        request_id: '',
      })
    if (t.approvalStatus !== 'approved')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Template não aprovado',
        request_id: '',
      })

    const [m] = await db
      .select({
        id: members.id,
        personPhone: persons.phone,
        personEmail: persons.email,
        personName: persons.name,
      })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(
        and(eq(members.id, parsed.memberId), eq(members.tenantId, session.logifit.tenantId)),
      )
      .limit(1)
    if (!m)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })

    const recipient =
      parsed.channel === 'email' ? m.personEmail : m.personPhone
    if (!recipient)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Member não tem ${parsed.channel === 'email' ? 'email' : 'telefone'} cadastrado`,
        request_id: '',
      })

    // Resolve vars: combina vars do input com vars padrão do member
    const allVars: Record<string, string> = {
      'member.name': m.personName ?? '',
      'member.email': m.personEmail ?? '',
      ...Object.fromEntries(Object.entries(parsed.variables).map(([k, v]) => [k, String(v)])),
    }
    const bodyRendered = renderTemplate(t.body, allVars)

    const [row] = await db
      .insert(messagesSent)
      .values({
        tenantId: session.logifit.tenantId,
        memberId: parsed.memberId,
        channel: parsed.channel,
        provider: 'stub', // MVP — substituído quando adapter real aterrissar
        templateId: parsed.templateId,
        status: 'queued',
        recipient,
        bodyRendered,
        variablesResolved: allVars,
      })
      .returning({ id: messagesSent.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao enfileirar mensagem',
        request_id: '',
      })

    setAuditResource(row.id, {
      member_id: parsed.memberId,
      template_id: parsed.templateId,
      channel: parsed.channel,
    })
    return { id: row.id, recipient, bodyRendered }
  },
)

// ─── listMessages ────────────────────────────────────────────────────────

export const listMessages = wrapServerAction(
  { module: 'mensagens', action: 'message.list' },
  async (input: z.infer<typeof ListMessagesInputSchema>, { session }) => {
    const parsed = ListMessagesInputSchema.parse(input)
    const conditions = [eq(messagesSent.tenantId, session.logifit.tenantId)]
    if (parsed.channel) conditions.push(eq(messagesSent.channel, parsed.channel))
    if (parsed.status) conditions.push(eq(messagesSent.status, parsed.status))

    const rows = await db
      .select({
        id: messagesSent.id,
        memberId: messagesSent.memberId,
        channel: messagesSent.channel,
        provider: messagesSent.provider,
        status: messagesSent.status,
        recipient: messagesSent.recipient,
        bodyRendered: messagesSent.bodyRendered,
        sentAt: messagesSent.sentAt,
        deliveredAt: messagesSent.deliveredAt,
        readAt: messagesSent.readAt,
        failedAt: messagesSent.failedAt,
        failureReason: messagesSent.failureReason,
        createdAt: messagesSent.createdAt,
        templateSlug: messageTemplates.slug,
        templateName: messageTemplates.name,
      })
      .from(messagesSent)
      .leftJoin(messageTemplates, eq(messageTemplates.id, messagesSent.templateId))
      .where(and(...conditions))
      .orderBy(desc(messagesSent.createdAt))
      .limit(parsed.limit)

    return { rows }
  },
)

// ─── listMemberMessages (widget perfil) ──────────────────────────────────

export const listMemberMessages = wrapServerAction(
  { module: 'mensagens', action: 'message.list_by_member' },
  async (
    input: z.infer<typeof ListMemberMessagesInputSchema>,
    { session },
  ) => {
    const parsed = ListMemberMessagesInputSchema.parse(input)
    const rows = await db
      .select({
        id: messagesSent.id,
        channel: messagesSent.channel,
        status: messagesSent.status,
        bodyRendered: messagesSent.bodyRendered,
        sentAt: messagesSent.sentAt,
        deliveredAt: messagesSent.deliveredAt,
        readAt: messagesSent.readAt,
        createdAt: messagesSent.createdAt,
        templateName: messageTemplates.name,
      })
      .from(messagesSent)
      .leftJoin(messageTemplates, eq(messageTemplates.id, messagesSent.templateId))
      .where(
        and(
          eq(messagesSent.tenantId, session.logifit.tenantId),
          eq(messagesSent.memberId, parsed.memberId),
        ),
      )
      .orderBy(desc(messagesSent.createdAt))
      .limit(parsed.limit)
    return { rows }
  },
)
