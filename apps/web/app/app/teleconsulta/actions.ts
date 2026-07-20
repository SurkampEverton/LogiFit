'use server'

/**
 * Server Actions Teleconsulta — Sprint 31 Faixa B.2 (ADR 0083).
 *
 * Caller é staff. Provider abstrato (Daily.co/Whereby/Jitsi/Twilio/Mock)
 * via `resolveTeleconsultaProvider()` de `@repo/ai/teleconsulta`.
 *
 * Actions:
 *   - scheduleTeleconsultation({appointmentId, memberId, enableRecording})
 *     — cria room via provider + persiste sessão status='scheduled'
 *   - startTeleconsultation({sessionId}) — marca started_at + status='active'
 *   - endTeleconsultation({sessionId, failureReason?}) — encerra room provider +
 *     update status='ended' + ended_at
 *   - listTeleconsultations({status?, memberId?, limit})
 *   - acceptRecordingConsent({sessionId}) — atualiza recording_consent_granted=true
 *   - acceptTranscriptionConsent({sessionId}) — análogo
 */

import { resolveTeleconsultaProvider } from '@repo/ai'
import { db } from '@repo/db/client'
import { appointments, members, persons, teleconsultationSessions } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

const ScheduleSchema = z.object({
  appointmentId: z.string().uuid(),
  memberId: z.string().uuid(),
  enableRecording: z.boolean().default(false),
  /** Duração máxima em minutos */
  maxDurationMinutes: z.number().int().min(5).max(180).default(60),
  /** Provider preferido (opcional; default conforme tenant settings) */
  provider: z.enum(['daily', 'whereby', 'jitsi', 'twilio', 'mock']).optional(),
})

const StartEndSchema = z.object({
  sessionId: z.string().uuid(),
})

const EndSchema = z.object({
  sessionId: z.string().uuid(),
  failureReason: z.string().max(500).optional().nullable(),
})

const ListSchema = z.object({
  status: z.enum(['scheduled', 'active', 'ended', 'cancelled', 'failed']).optional().nullable(),
  memberId: z.string().uuid().optional().nullable(),
  limit: z.number().int().min(1).max(100).default(50),
})

const ConsentSchema = z.object({
  sessionId: z.string().uuid(),
})

// ─── scheduleTeleconsultation ───────────────────────────────────────────

export const scheduleTeleconsultation = wrapServerAction(
  {
    module: 'teleconsulta',
    action: 'session.schedule',
    resourceType: 'teleconsultation_sessions',
  },
  async (input: z.infer<typeof ScheduleSchema>, { session, setAuditResource }) => {
    const parsed = ScheduleSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida appointment + member do tenant
    const [appt] = await db
      .select({ id: appointments.id, memberId: appointments.memberId })
      .from(appointments)
      .where(and(eq(appointments.id, parsed.appointmentId), eq(appointments.tenantId, tenantId)))
      .limit(1)
    if (!appt) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Appointment não encontrado',
        request_id: '',
      })
    }
    if (appt.memberId !== parsed.memberId) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Member não bate com o appointment',
        request_id: '',
      })
    }

    const sessionId = crypto.randomUUID()
    const slug = `lf-${sessionId.slice(0, 8)}`

    // Cria room no provider
    const provider = resolveTeleconsultaProvider(parsed.provider)
    const room = await provider.createRoom({
      sessionId,
      roomSlug: slug,
      maxDurationMinutes: parsed.maxDurationMinutes,
      enableRecording: parsed.enableRecording,
    })

    const [row] = await db
      .insert(teleconsultationSessions)
      .values({
        id: sessionId,
        tenantId,
        appointmentId: parsed.appointmentId,
        memberId: parsed.memberId,
        professionalUserId: session.logifit.userId,
        provider: provider.name === 'mock' ? 'other' : provider.name,
        roomId: room.roomId,
        roomUrl: room.roomUrl,
        accessToken: room.accessToken,
        status: 'scheduled',
        recordingConsentGranted: false,
        transcriptionConsentGranted: false,
      })
      .returning({ id: teleconsultationSessions.id })

    setAuditResource(row!.id, {
      appointment_id: parsed.appointmentId,
      member_id: parsed.memberId,
      provider: provider.name,
      enable_recording: parsed.enableRecording,
    })

    return {
      ok: true as const,
      sessionId: row!.id,
      provider: provider.name,
      roomUrl: room.roomUrl,
    }
  },
)

// ─── startTeleconsultation ──────────────────────────────────────────────

export const startTeleconsultation = wrapServerAction(
  {
    module: 'teleconsulta',
    action: 'session.start',
    resourceType: 'teleconsultation_sessions',
  },
  async (input: z.infer<typeof StartEndSchema>, { session, setAuditResource }) => {
    const parsed = StartEndSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(teleconsultationSessions)
      .set({
        status: 'active',
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(teleconsultationSessions.id, parsed.sessionId),
          eq(teleconsultationSessions.tenantId, tenantId),
          eq(teleconsultationSessions.status, 'scheduled'),
        ),
      )
      .returning({ id: teleconsultationSessions.id })

    if (!row) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Sessão não encontrada ou não está em scheduled',
        request_id: '',
      })
    }
    setAuditResource(row.id, {})
    return { ok: true as const }
  },
)

// ─── endTeleconsultation ────────────────────────────────────────────────

export const endTeleconsultation = wrapServerAction(
  {
    module: 'teleconsulta',
    action: 'session.end',
    resourceType: 'teleconsultation_sessions',
  },
  async (input: z.infer<typeof EndSchema>, { session, setAuditResource }) => {
    const parsed = EndSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [existing] = await db
      .select()
      .from(teleconsultationSessions)
      .where(
        and(
          eq(teleconsultationSessions.id, parsed.sessionId),
          eq(teleconsultationSessions.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!existing) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Sessão não encontrada',
        request_id: '',
      })
    }
    if (existing.status === 'ended' || existing.status === 'cancelled') {
      return { ok: true as const, alreadyEnded: true }
    }

    // Encerra room no provider (best-effort)
    try {
      const provider = resolveTeleconsultaProvider(
        (existing.provider === 'other' ? 'mock' : existing.provider) as never,
      )
      await provider.endRoom(existing.roomId)
    } catch (err) {
      // Não bloqueia o end — log e segue
      console.warn('[teleconsulta] endRoom falhou:', err)
    }

    const newStatus = parsed.failureReason ? 'failed' : 'ended'
    await db
      .update(teleconsultationSessions)
      .set({
        status: newStatus,
        endedAt: new Date(),
        failureReason: parsed.failureReason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(teleconsultationSessions.id, parsed.sessionId))

    setAuditResource(parsed.sessionId, { status: newStatus, failure: parsed.failureReason })
    return { ok: true as const }
  },
)

// ─── listTeleconsultations ──────────────────────────────────────────────

export const listTeleconsultations = wrapServerAction(
  { module: 'teleconsulta', action: 'session.list' },
  async (input: z.infer<typeof ListSchema>, { session }) => {
    const parsed = ListSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const conditions = [eq(teleconsultationSessions.tenantId, tenantId)]
    if (parsed.status) conditions.push(eq(teleconsultationSessions.status, parsed.status))
    if (parsed.memberId) conditions.push(eq(teleconsultationSessions.memberId, parsed.memberId))

    const rows = await db
      .select({
        id: teleconsultationSessions.id,
        appointmentId: teleconsultationSessions.appointmentId,
        memberId: teleconsultationSessions.memberId,
        memberName: persons.name,
        provider: teleconsultationSessions.provider,
        status: teleconsultationSessions.status,
        roomUrl: teleconsultationSessions.roomUrl,
        startedAt: teleconsultationSessions.startedAt,
        endedAt: teleconsultationSessions.endedAt,
        recordingConsentGranted: teleconsultationSessions.recordingConsentGranted,
        transcriptionConsentGranted: teleconsultationSessions.transcriptionConsentGranted,
        createdAt: teleconsultationSessions.createdAt,
      })
      .from(teleconsultationSessions)
      .innerJoin(members, eq(members.id, teleconsultationSessions.memberId))
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(...conditions))
      .orderBy(desc(teleconsultationSessions.createdAt))
      .limit(parsed.limit)

    return { ok: true as const, rows }
  },
)

// ─── acceptRecordingConsent / acceptTranscriptionConsent ─────────────────

export const acceptRecordingConsent = wrapServerAction(
  {
    module: 'teleconsulta',
    action: 'consent.recording',
    resourceType: 'teleconsultation_sessions',
  },
  async (input: z.infer<typeof ConsentSchema>, { session, setAuditResource }) => {
    const parsed = ConsentSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(teleconsultationSessions)
      .set({ recordingConsentGranted: true, updatedAt: new Date() })
      .where(
        and(
          eq(teleconsultationSessions.id, parsed.sessionId),
          eq(teleconsultationSessions.tenantId, tenantId),
        ),
      )
      .returning({ id: teleconsultationSessions.id })

    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Sessão não encontrada',
        request_id: '',
      })
    }
    setAuditResource(row.id, { consent: 'recording' })
    return { ok: true as const }
  },
)

export const acceptTranscriptionConsent = wrapServerAction(
  {
    module: 'teleconsulta',
    action: 'consent.transcription',
    resourceType: 'teleconsultation_sessions',
  },
  async (input: z.infer<typeof ConsentSchema>, { session, setAuditResource }) => {
    const parsed = ConsentSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(teleconsultationSessions)
      .set({ transcriptionConsentGranted: true, updatedAt: new Date() })
      .where(
        and(
          eq(teleconsultationSessions.id, parsed.sessionId),
          eq(teleconsultationSessions.tenantId, tenantId),
        ),
      )
      .returning({ id: teleconsultationSessions.id })

    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Sessão não encontrada',
        request_id: '',
      })
    }
    setAuditResource(row.id, { consent: 'transcription' })
    return { ok: true as const }
  },
)
