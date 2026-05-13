'use server'

/**
 * Server Actions de support_tickets — Sprint 06 Faixa C.
 *
 * - `openTicket` — usuário (ou assistente via tool report_issue) abre ticket.
 * - `updateTicketStatus` — admin tenant resolve/cancela.
 *
 * Sprint 13 adiciona email Resend ao admin quando ticket aberto.
 */
import { db } from '@repo/db/client'
import { supportTickets } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

const OpenTicketInput = z.object({
  title: z.string().min(2).max(120),
  description: z.string().min(2).max(4000),
  category: z
    .enum(['bug', 'question', 'feature_request', 'billing', 'other'])
    .default('other'),
  context: z.record(z.string(), z.unknown()).optional(),
  openedByAssistant: z.boolean().default(false),
})

const UpdateTicketInput = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(['open', 'in_progress', 'resolved', 'cancelled']),
})

export const openTicket = wrapServerAction(
  { module: 'suporte', action: 'support_ticket.open', resourceType: 'support_tickets' },
  async (input: z.infer<typeof OpenTicketInput>, { session, setAuditResource }) => {
    const parsed = OpenTicketInput.parse(input)
    const [row] = await db
      .insert(supportTickets)
      .values({
        tenantId: session.logifit.tenantId,
        userId: session.logifit.userId,
        title: parsed.title,
        description: parsed.description,
        category: parsed.category,
        context: parsed.context ?? {},
        openedByAssistant: parsed.openedByAssistant,
      })
      .returning({ id: supportTickets.id, status: supportTickets.status })
    if (!row) {
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao abrir ticket',
        request_id: crypto.randomUUID(),
      })
    }
    setAuditResource(row.id, { category: parsed.category })
    return { ticketId: row.id, status: row.status }
  },
)

export const updateTicketStatus = wrapServerAction(
  { module: 'suporte', action: 'support_ticket.update_status', resourceType: 'support_tickets' },
  async (input: z.infer<typeof UpdateTicketInput>, { session, setAuditResource }) => {
    const parsed = UpdateTicketInput.parse(input)
    const updated = await db
      .update(supportTickets)
      .set({ status: parsed.status, updatedAt: new Date() })
      .where(
        and(
          eq(supportTickets.id, parsed.ticketId),
          eq(supportTickets.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: supportTickets.id })
    if (updated.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Ticket não encontrado',
        request_id: crypto.randomUUID(),
      })
    }
    setAuditResource(updated[0]!.id, { new_status: parsed.status })
    return { ticketId: updated[0]!.id, status: parsed.status }
  },
)
