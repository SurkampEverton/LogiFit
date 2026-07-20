/**
 * Compliance / governança — Sprint 01b restantes (CFM 2.454/2026, LGPD art. 18, PAM).
 *
 * 3 grupos de tabelas:
 *   - **Comitê IA** (CFM 2.454/2026 — instituição com IA classe SaMD II+ exige
 *     comitê interno + ata): `ai_committees` + `ai_committee_members` +
 *     `ai_committee_decisions`
 *   - **PAM** (Privileged Access Management — super_admin LogiFit acessa dados
 *     do tenant via sessão elevada com motivo + audit): `privileged_sessions`
 *   - **Direitos do titular LGPD art. 18** (acesso, anonimização, exportação,
 *     correção): `data_subject_requests`
 *
 * Schemas finais do Sprint 01b — fechamento do 25% pendente. Sprint 06/07/26
 * vão consumir conforme features aterrissam.
 */
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { persons } from './persons'

// ─── Enums ───────────────────────────────────────────────────────────────

export const committeeStatusEnum = pgEnum('ai_committee_status', [
  'draft', // criado, sem ata
  'active', // ata assinada, atas atualizadas periodicamente
  'suspended', // suspenso temporariamente (auditoria interna em curso)
])

export const committeeRoleEnum = pgEnum('ai_committee_role', [
  'coordenador', // 1 obrigatório
  'medico', // representante CRM
  'enfermeiro', // representante COREN
  'fisio', // representante CREFITO
  'nutri', // representante CRN
  'ti', // representante TI/dados
  'dpo', // DPO da instituição
  'juridico', // jurídico
  'paciente', // representante de paciente (best practice)
])

export const dsrKindEnum = pgEnum('data_subject_request_kind', [
  'access', // art. 18 II — acesso aos dados
  'anonymization', // art. 18 VI — anonimização (preservar agregados)
  'deletion', // art. 18 VI — eliminação (compatível com retenção 20a CFM/COFFITO)
  'correction', // art. 18 III — correção de dados incompletos/desatualizados
  'portability', // art. 18 V — portabilidade JSON estruturado
  'consent_revocation', // art. 18 IX — revogação consent (cria row nova em consents)
  'opposition', // art. 18 § 2º — oposição ao tratamento
])

export const dsrStateEnum = pgEnum('data_subject_request_state', [
  'received', // chegou; aguarda triagem DPO
  'triaged', // DPO classificou + estimou prazo
  'in_progress', // execução em andamento
  'awaiting_titular', // aguarda info adicional do titular
  'fulfilled', // concluída (Resolução ANPD 2/2024: 15 dias úteis)
  'partially_fulfilled', // parcial (alguns itens não retornáveis — segredo de negócio etc)
  'rejected', // rejeitada com motivo (mostrar art. 18 § 7º bases para recusa)
  'cancelled', // titular cancelou
])

export const pamReasonEnum = pgEnum('pam_reason', [
  'support', // suporte solicitado pelo tenant
  'incident_response', // incidente de segurança
  'data_subject_request', // executar DSR LGPD
  'audit', // auditoria interna
  'migration', // migração de dados
  'forensics', // análise forense pós-incidente
])

// ─── Comitê de IA (CFM 2.454/2026) ───────────────────────────────────────
/**
 * Cada tenant cliente que ativa feature IA classe SaMD II+ precisa cadastrar
 * comitê interno (ata + composição mínima + papéis). Gate de feature flag
 * verifica que `ai_committees.status='active'` antes de liberar (regra 28).
 *
 * Schema simples MVP: 1 comitê por tenant (ativo). Sprint 06+ pode expandir.
 */
export const aiCommittees = pgTable(
  'ai_committees',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    status: committeeStatusEnum('status').notNull().default('draft'),
    chartedAt: timestamp('charted_at', { withTimezone: true }), // data da ata de constituição
    chartUrl: text('chart_url'), // URL pra ata em PDF (MinIO Sprint 09+)
    chartHash: text('chart_hash'), // sha256 da ata pra integridade
    bylaws: jsonb('bylaws'), // estatuto/regimento (jsonb estruturado)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_committees_tenant_active_uq').on(t.tenantId).where(sql`status = 'active'`),
    index('ai_committees_tenant_idx').on(t.tenantId),
  ],
)

export const aiCommitteeMembers = pgTable(
  'ai_committee_members',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    committeeId: uuid('committee_id')
      .notNull()
      .references(() => aiCommittees.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    role: committeeRoleEnum('role').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('ai_committee_members_committee_idx').on(t.committeeId),
    uniqueIndex('ai_committee_members_active_uq')
      .on(t.committeeId, t.personId, t.role)
      .where(sql`ended_at IS NULL`),
  ],
)

export const aiCommitteeDecisions = pgTable(
  'ai_committee_decisions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    committeeId: uuid('committee_id')
      .notNull()
      .references(() => aiCommittees.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    subject: text('subject').notNull(), // ex: "Aprovação feature IA chat clínico classe SaMD II"
    decision: text('decision').notNull(), // approved | rejected | pending_more_info
    rationale: text('rationale').notNull(),
    minuteUrl: text('minute_url'), // ata da reunião em PDF
    minuteHash: text('minute_hash'),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_committee_decisions_committee_idx').on(t.committeeId, t.decidedAt)],
)

// ─── PAM (Privileged Access Management) ──────────────────────────────────
/**
 * Sessões elevadas — super_admin LogiFit acessa dados do tenant via PAM com
 * motivo declarado + audit completo. Defesa em profundidade contra abuso
 * interno + compliance LGPD art. 50 (programa de governança).
 *
 * Padrão de uso:
 *   1. Super-admin solicita sessão (`POST /api/pam/sessions`) com tenant_id +
 *      reason + estimated_duration
 *   2. Cria row state=`pending`; expires_at=now+30min default
 *   3. Outro super-admin aprova (2-eye rule) → state=`active`
 *   4. Operações realizadas durante a sessão são logged em pam_session_events
 *      (Sprint 09+ adiciona essa tabela)
 *   5. Auto-revoke após expires_at OU operador clica "Encerrar" → state=`closed`
 */
export const privilegedSessions = pgTable(
  'privileged_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    operatorUserId: uuid('operator_user_id')
      .notNull()
      .references(() => users.id),
    targetTenantId: uuid('target_tenant_id').notNull(),
    reason: pamReasonEnum('reason').notNull(),
    rationale: text('rationale').notNull(), // motivo livre (obrigatório)
    state: text('state').notNull().default('pending'), // 'pending' | 'active' | 'closed' | 'rejected'
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeReason: text('close_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('privileged_sessions_target_idx').on(t.targetTenantId, t.createdAt),
    index('privileged_sessions_operator_idx').on(t.operatorUserId, t.createdAt),
    index('privileged_sessions_active_idx').on(t.targetTenantId).where(sql`state = 'active'`),
    check(
      'privileged_sessions_state_valid',
      sql`${t.state} IN ('pending', 'active', 'closed', 'rejected')`,
    ),
    check(
      'privileged_sessions_two_eye_when_active',
      sql`(state != 'active') OR (approved_by_user_id IS NOT NULL AND approved_by_user_id != operator_user_id)`,
    ),
  ],
)

// ─── data_subject_requests (LGPD art. 18 — direitos do titular) ──────────
/**
 * Requisições do titular (member, paciente, etc) sobre seus dados. SLA 15 dias
 * úteis (Resolução ANPD 2/2024). DPO triamenta + DSR workflow.
 *
 * Schema base. Sprint 26 `/meu/privacidade` portal completo. Aqui é stub pra
 * Sprint 01b fechar 100% — manual via DPO `privacidade@logifit.com.br` (regra
 * 29 + ADR 0054).
 */
export const dataSubjectRequests = pgTable(
  'data_subject_requests',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    subjectPersonId: uuid('subject_person_id').references(() => persons.id),
    subjectEmail: text('subject_email'), // se não tem person cadastrada
    subjectName: text('subject_name'),
    subjectDocument: text('subject_document'), // CPF/RG pra validação identidade
    kind: dsrKindEnum('kind').notNull(),
    state: dsrStateEnum('state').notNull().default('received'),
    requestPayload: jsonb('request_payload'), // detalhes (escopo, dados específicos solicitados)
    fulfillmentPayload: jsonb('fulfillment_payload'), // resultado da execução (URLs export, dados anonimizados, etc)
    triageNotes: text('triage_notes'),
    triagedByUserId: uuid('triaged_by_user_id').references(() => users.id),
    triagedAt: timestamp('triaged_at', { withTimezone: true }),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    fulfilledByUserId: uuid('fulfilled_by_user_id').references(() => users.id),
    rejectionReason: text('rejection_reason'), // se state='rejected'
    legalBasisCited: text('legal_basis_cited'), // base legal pra recusa (art. 18 § 7º)
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dsr_tenant_state_idx').on(t.tenantId, t.state, t.createdAt),
    index('dsr_subject_idx').on(t.subjectPersonId),
    index('dsr_sla_idx')
      .on(t.tenantId, t.slaDueAt)
      .where(sql`state NOT IN ('fulfilled', 'partially_fulfilled', 'rejected', 'cancelled')`),
  ],
)
