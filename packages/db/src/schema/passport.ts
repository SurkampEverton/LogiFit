/**
 * Passaporte do paciente cross-tenant — Sprint 01b Faixa B (regra 42 + ADR 0077).
 *
 * **Modelo C híbrido** (decisão ADR 0077):
 *   - `patient_company_links` — N:N entre paciente (person) e tenant; cada link
 *     tem status (`active`/`revoked`/`pending`) + módulos liberados (via N:N
 *     `patient_link_modules`)
 *   - `patient_link_modules` — quais módulos clínicos foram autorizados no
 *     link + responsável técnico (atende CFM/COFFITO/CFN/CONFEF)
 *   - `patient_data_access_log` — TODA leitura cross-tenant grava aqui
 *     (regra 42 + retenção 5 anos via regra 5)
 *
 * **Constraint global**: 1 módulo ativo por (paciente, módulo_canônico) em
 * TODA a rede LogiFit. Nova empresa do MESMO módulo dispara substituição
 * com confirmação do paciente (UI Sprint 02+).
 *
 * **5 módulos canônicos** MVP via lookup `passport_modules` (extensível):
 *   academia, personal_training, fisioterapia, nutricao, pilates.
 *
 * **Limites duros** (NÃO cruzam tenant):
 *   - financeiro
 *   - prontuário CFM original (só RESUMO gerado pelo paciente cruza)
 *   - dado de outras pessoas mencionado em prontuário
 *
 * **5 níveis de dados** (cresce com cada nível autorizado):
 *   1. Identidade (nome, contato)
 *   2. Antropometria (peso, altura, %BF)
 *   3. Treino (workout, RPE, frequência)
 *   4. Clínico (sintomas, restrições, CIDs)
 *   5. Workspace (NUNCA cruza)
 *
 * Sprint 01b Faixa B: schema only. Sprint 02+ implementa UI + Server Actions
 * + cron de log particionamento mensal.
 */
import { sql } from 'drizzle-orm'
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants, users } from './identity'
import { persons } from './persons'

// Status do link (regra 42 §estados)
export const passportLinkStatusEnum = pgEnum('passport_link_status', [
  'active',
  'revoked',
  'pending', // aguardando aceite do paciente (path "reativo")
])

// 5 módulos canônicos MVP (regra 42 + ADR 0077)
export const passportModuleEnum = pgEnum('passport_module', [
  'academia',
  'personal_training',
  'fisioterapia',
  'nutricao',
  'pilates',
])

// Status do módulo individual no link
export const passportModuleStatusEnum = pgEnum('passport_module_status', [
  'active',
  'inactive', // substituído por outra empresa (constraint global)
  'pending', // aguardando aceite específico do módulo
])

// ─── patient_company_links ────────────────────────────────────────────────
// Vínculo entre paciente (person) e tenant (company representa o tenant).
// Cada paciente pode ter N links com N tenants distintos.
//
// **Importante**: persons aqui é uma "persons proxy" — paciente é representado
// em CADA tenant como uma `persons` row independente (isolamento RLS Sprint 01a).
// Esse vínculo `patient_company_links` ASSOCIA persons rows de DIFERENTES
// tenants ao MESMO paciente (mesmo CPF). Lookup via `persons.document` +
// `passport_passport_id` global.
export const patientCompanyLinks = pgTable(
  'patient_company_links',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),

    // Identidade global do paciente (mesmo CPF em N tenants compartilha este id)
    // Sprint 02+ refinará pra `patient_global_id` derivado de hash(cpf).
    passportPassportId: uuid('passport_passport_id').notNull(),

    // person dentro de cada tenant — 1 row por (passportPassportId, tenant)
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    status: passportLinkStatusEnum('status').notNull().default('pending'),

    // Path de criação (regra 42 §2 paths)
    creationPath: text('creation_path').notNull(), // 'reactive' (invite) | 'proactive' (self-signup)

    // Convites
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 1 link ativo por (paciente, tenant)
    uniqueIndex('patient_company_links_passport_tenant_uq')
      .on(t.passportPassportId, t.tenantId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('patient_company_links_passport_idx').on(t.passportPassportId),
    index('patient_company_links_tenant_idx').on(t.tenantId),
    index('patient_company_links_person_idx').on(t.personId),
  ],
)

// ─── patient_link_modules ────────────────────────────────────────────────
// Quais módulos foram autorizados no link + responsável técnico por módulo
// (atende CFM 2.299, COFFITO 414/415, CFN 599, CONFEF/CREF — exige
// profissional registrado no conselho do módulo).
//
// **Constraint global crítica** (regra 42): 1 módulo ativo por
// (passport, module) em TODA a rede LogiFit. Nova empresa do mesmo módulo
// dispara substituição via UI Sprint 02+.
export const patientLinkModules = pgTable(
  'patient_link_modules',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    linkId: uuid('link_id')
      .notNull()
      .references(() => patientCompanyLinks.id, { onDelete: 'cascade' }),
    passportPassportId: uuid('passport_passport_id').notNull(), // denormalizado pra constraint global

    module: passportModuleEnum('module').notNull(),
    status: passportModuleStatusEnum('status').notNull().default('pending'),

    // Responsável técnico (profissional registrado no conselho do módulo)
    responsibleProfessionalUserId: uuid('responsible_professional_user_id').references(
      () => users.id,
    ),
    // FK opcional pro registro do conselho dele (Sprint 01b Faixa A)
    responsibleRegistrationId: uuid('responsible_registration_id'),

    // 5 níveis de dados autorizados (jsonb pra simplicidade; Sprint 02+ refina)
    // { identidade: true, antropometria: true, treino: true, clinico: false, workspace: false }
    dataLevels: jsonb('data_levels'),

    activatedAt: timestamp('activated_at', { withTimezone: true }),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deactivatedReason: text('deactivated_reason'), // 'substituted_by_other_tenant' | 'patient_revoked' | ...

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // **Constraint global**: 1 módulo ativo por (passport, module) em TODA a rede
    uniqueIndex('patient_link_modules_global_active_uq')
      .on(t.passportPassportId, t.module)
      .where(sql`${t.deactivatedAt} IS NULL`),
    index('patient_link_modules_link_idx').on(t.linkId),
    index('patient_link_modules_passport_idx').on(t.passportPassportId),
  ],
)

// ─── patient_data_access_log ─────────────────────────────────────────────
// **Regra 42 obrigatória**: TODA leitura cross-tenant grava aqui.
// Particionamento por mês adiado pra Sprint 04+ (regra 34 ativa quando
// volume real chegar — estimativa 10-15M linhas/ano com adoção real).
// Retenção 5 anos (regra 5).
//
// Lint custom `cross-tenant-read-must-log` (já implementado Sprint 00
// Faixa 4 como detector "ready") bloqueia código que faz query cross-tenant
// sem chamar `logCrossTenantAccess()` que insere aqui.
export const patientDataAccessLog = pgTable(
  'patient_data_access_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    // Quem leu (reader)
    readerUserId: uuid('reader_user_id').notNull(),
    readerTenantId: uuid('reader_tenant_id').notNull(),

    // De onde veio o dado (source)
    sourceTenantId: uuid('source_tenant_id').notNull(),

    // Qual paciente (passport id global — pode resolver em multiple persons rows)
    patientPersonId: uuid('patient_person_id').notNull(),
    passportPassportId: uuid('passport_passport_id').notNull(),

    moduleType: passportModuleEnum('module_type').notNull(),
    // category = data level acessado: 'identidade' | 'antropometria' | 'treino' | 'clinico' (workspace nunca cruza)
    category: text('category').notNull(),
    resourceType: text('resource_type'), // 'evolucao' | 'avaliacao' | 'plano' | etc
    resourceId: uuid('resource_id'),

    // Correlation com wrapAction request_id (Faixa F Sprint 01a)
    requestId: uuid('request_id').notNull(),
    ip: text('ip'), // inet pra mais correto, mas text simplifica testes
    userAgent: text('user_agent'),
  },
  (t) => [
    index('patient_data_access_log_reader_tenant_at_idx').on(t.readerTenantId, t.recordedAt.desc()),
    index('patient_data_access_log_source_tenant_at_idx').on(t.sourceTenantId, t.recordedAt.desc()),
    index('patient_data_access_log_patient_at_idx').on(t.patientPersonId, t.recordedAt.desc()),
    index('patient_data_access_log_passport_at_idx').on(t.passportPassportId, t.recordedAt.desc()),
  ],
)

// ─── patient_link_events ─────────────────────────────────────────────────
// Sprint 02c.4 — event log dedicado pro lifecycle de vínculos cross-tenant
// (ADR 0077). Substitui timeline derivada de timestamps em
// `/app/passport/invites/[id]` por evento append-only.
//
// **Particionada por mês** (regra 34 + ADR 0072) — criação via SQL custom em
// migration 0049 (`CREATE TABLE ... PARTITION BY RANGE (created_at)`); Drizzle
// só "vê" como tabela normal pra fins de types + queries (PG routing
// transparente).
//
// **Volume estimado**: link tem ~6-10 eventos no lifecycle (created → invite
// dispatched → accepted → N modules added/activated → N modules deactivated
// → revoked). Em 10k tenants × 200 pacientes × 8 eventos = 16M/ano. Particiona.
//
// **Append-only** (regra 5 + 39): sem UPDATE/DELETE policy; INSERT só com
// `tenant_id = current_setting('app.tenant_id')`. Hash chain NÃO se aplica
// (já temos audit_log com chain — eventos são auditoria operacional, não
// trilha forense).
//
// **Actor**: quem causou o evento:
//   - `professional` — staff do tenant (action via /app/passport)
//   - `patient` — paciente (action via /meu/* ou /i/[token])
//   - `system` — cron, trigger SQL, dispatcher (substituição automática etc)
//
// **event_kind**: lookup canônico dos lifecycle events. Catálogo extensível
// via migration nova (nunca quebra append-only).
export const passportEventActorEnum = pgEnum('passport_event_actor', [
  'professional',
  'patient',
  'system',
])

export const passportEventKindEnum = pgEnum('passport_event_kind', [
  'invite_sent', // sendPatientInvite — link criado em 'pending'
  'invite_resent', // resendPatientInvite (Sprint 02d+) — re-dispatch sem mudar status
  'invite_cancelled', // cancelPatientInvite — staff cancela pending
  'link_accepted', // acceptPatientInvite — paciente aceita
  'link_revoked', // revokePatientLink — staff/paciente revoga active
  'module_added', // 1 por module no sendPatientInvite
  'module_activated', // module passa pra status='active' (accept ou substitute)
  'module_deactivated', // module passa pra status='inactive' (revoke ou substitute)
  'module_substituted', // confirmModuleSubstitution — passport global troca tenant
  'data_levels_changed', // setSharingLevel — staff ajusta dataLevels do module
])

export const patientLinkEvents = pgTable(
  'patient_link_events',
  {
    id: uuid('id').notNull().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),

    // Link de referência (opcional pro futuro: alguns eventos system-level
    // sobre passportId podem não ter link específico). MVP: sempre populado.
    linkId: uuid('link_id'),

    // Identificadores derivados pro replay/aggregate sem JOIN
    passportPassportId: uuid('passport_passport_id').notNull(),
    patientPersonId: uuid('patient_person_id').notNull(),

    // Quem causou o evento
    actorKind: passportEventActorEnum('actor_kind').notNull(),
    actorUserId: uuid('actor_user_id'), // null pra 'patient' (passport-side) ou 'system'

    // O que aconteceu
    eventKind: passportEventKindEnum('event_kind').notNull(),

    // Detalhes — payload jsonb (NUNCA PII bruto; só refs + diffs)
    // Ex (module_added): { module: 'fisioterapia', responsibleUserId: '...', dataLevels: {...} }
    // Ex (link_revoked): { reason: 'cancelled_by_staff' }
    // Ex (data_levels_changed): { module: 'academia', from: {...}, to: {...} }
    payload: jsonb('payload'),

    // Correlation request_id (de @repo/errors wrapAction)
    requestId: uuid('request_id'),

    // PK efetiva inclui created_at pra ser compatível com particionamento
    // (Postgres exige PK incluir coluna de partição).
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // PK composta: id + created_at (regra de PG particionado)
    uniqueIndex('patient_link_events_pk').on(t.id, t.createdAt),
    index('patient_link_events_tenant_at_idx').on(t.tenantId, t.createdAt.desc()),
    index('patient_link_events_link_at_idx').on(t.linkId, t.createdAt.desc()),
    index('patient_link_events_passport_at_idx').on(t.passportPassportId, t.createdAt.desc()),
  ],
)

export type PatientCompanyLinkRow = typeof patientCompanyLinks.$inferSelect
export type PatientLinkModuleRow = typeof patientLinkModules.$inferSelect
export type PatientDataAccessLogRow = typeof patientDataAccessLog.$inferSelect
export type PatientLinkEventRow = typeof patientLinkEvents.$inferSelect
export type PatientLinkEventInsert = typeof patientLinkEvents.$inferInsert
