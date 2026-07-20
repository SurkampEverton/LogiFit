/**
 * Teleconsulta — Sprint 31 Faixa A (ADR 0083 esperado).
 *
 * 1 tabela:
 *   - `teleconsultation_sessions` — sessão de videoconferência vinculada a
 *     `appointment_id` (Sprint 03) + opcionalmente a `consulta_id` (Sprint 20)
 *     quando profissional registra o ato. Provider abstrato (Daily.co default,
 *     Whereby/Jitsi/Twilio alternativos — ADR 0083).
 *
 * **Consent obrigatório de gravação** (regra 29 + LGPD art. 11): paciente
 * precisa aceitar antes da gravação começar. UI dispara `confirmDialog`
 * (regra 45) com texto LGPD; consent vira `recording_consent_granted=true`.
 *
 * **Transcrição via Groq Whisper** (ADR 0064): áudio → task='transcription' →
 * transcript jsonb estruturado em turnos. `transcription_consent_granted` separa
 * o consent de gravação do de transcrição (paciente pode aceitar gravar mas
 * não transcrever, por exemplo). Sprint 31b conecta `resolveModelForTask`.
 *
 * **Rascunho SOAP** (Sprint 31b): após transcrição pronta, dispara agent
 * `soap_drafter` que gera 4 seções S/O/A/P → profissional revisa + edita +
 * assina → consulta Sprint 20 oficial criada. Audit em `ai_audit_log` (regra 28).
 *
 * Retenção: 20 anos (Lei 13.787 — vincula a prontuário quando há `consulta_id`).
 *
 * @volume_estimate_yearly: 360000
 *   (1k tenants × 30 teleconsultas/mês × 12 = 360k/ano — particionamento
 *   nasce sem; entra Sprint 31b se volume validar)
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { appointments } from './agenda'
import { consultas } from './fisio'
import { users } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const teleconsultaProviderEnum = pgEnum('teleconsulta_provider', [
  'daily', // Daily.co (default ADR 0083)
  'whereby', // Whereby Embed
  'jitsi', // Jitsi auto-hospedado
  'twilio', // Twilio Video
  'other',
])

export const teleconsultaStatusEnum = pgEnum('teleconsulta_status', [
  'scheduled', // sala criada, aguarda início
  'active', // chamada em andamento
  'ended', // chamada terminou normalmente
  'cancelled', // cancelada antes de iniciar
  'failed', // erro técnico (provider falhou, conexão caiu)
])

// ─── teleconsultation_sessions ──────────────────────────────────────────

export const teleconsultationSessions = pgTable(
  'teleconsultation_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    /** Appointment de origem (Sprint 03 com kind='online' ou flag is_online) */
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'restrict' }),
    /** Member que vai entrar como paciente */
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** Profissional responsável */
    professionalUserId: uuid('professional_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Consulta gerada ao fim (Sprint 20) — opcional, preenchida quando profissional registra ato */
    consultaId: uuid('consulta_id').references(() => consultas.id, {
      onDelete: 'set null',
    }),
    /** Provider escolhido (ADR 0083) */
    provider: teleconsultaProviderEnum('provider').notNull().default('daily'),
    /** ID da sala no provider (Daily room URL, Whereby slug, etc) */
    roomId: text('room_id').notNull(),
    /** URL completa que o frontend usa pra embed */
    roomUrl: text('room_url'),
    /** Token JWT/curto pra acesso (provider-specific) */
    accessToken: text('access_token'),
    status: teleconsultaStatusEnum('status').notNull().default('scheduled'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Consent flags (LGPD art. 11 — gravação e transcrição são duas finalidades distintas) */
    recordingConsentGranted: boolean('recording_consent_granted').notNull().default(false),
    transcriptionConsentGranted: boolean('transcription_consent_granted').notNull().default(false),
    /** Caminho da gravação em MinIO (bucket `teleconsulta-gravacoes`) */
    recordingStoragePath: text('recording_storage_path'),
    /** Caminho do transcript JSON em MinIO (bucket `teleconsulta-transcripts`) */
    transcriptStoragePath: text('transcript_storage_path'),
    /** Transcript estruturado (jsonb) — quando STT concluído e consent granted */
    transcript: jsonb('transcript'),
    /** Log de participantes (jsonb): {events: [{userId, action, at}]} */
    participantsLog: jsonb('participants_log'),
    /** Erro técnico se status='failed' */
    failureReason: text('failure_reason'),
    /** Rascunho SOAP gerado pela IA (Sprint 31b) — antes de virar consulta oficial */
    aiDraftSoap: jsonb('ai_draft_soap'),
    /** Status do draft IA: 'pending' | 'generated' | 'accepted' | 'edited' | 'rejected' */
    aiDraftStatus: text('ai_draft_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('telecon_tenant_status_idx').on(t.tenantId, t.status, t.createdAt.desc()),
    index('telecon_member_idx').on(t.memberId, t.createdAt.desc()),
    index('telecon_professional_idx').on(t.professionalUserId, t.createdAt.desc()),
    index('telecon_appointment_idx').on(t.appointmentId),
    /** Lookup quente: sessões ativas (status=active) */
    index('telecon_active_idx')
      .on(t.tenantId)
      .where(sql`status = 'active'`),
    check(
      'telecon_ended_consistency',
      sql`(status NOT IN ('ended', 'cancelled', 'failed') OR ended_at IS NOT NULL)`,
    ),
    check(
      'telecon_recording_requires_consent',
      sql`recording_storage_path IS NULL OR recording_consent_granted = true`,
    ),
    check(
      'telecon_transcript_requires_consent',
      sql`transcript IS NULL OR transcription_consent_granted = true`,
    ),
  ],
)

export type TeleconsultationSessionRow = typeof teleconsultationSessions.$inferSelect
