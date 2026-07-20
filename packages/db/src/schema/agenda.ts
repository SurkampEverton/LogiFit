/**
 * Agenda Universal — Sprint 03 Faixa A (ADR 0012 esperado).
 *
 * Modelo: `resources` (instrutor/sala/equipamento) + `recurring_slots` (regras
 * RFC 5545 RRULE materializadas lazy) + `appointments` (agendamentos confirmados)
 * + `appointment_waitlist` (lista de espera quando slot lotado).
 *
 * **Constraint crítica em appointments** (Sprint 03 Faixa A SQL puro):
 * ```
 * EXCLUDE USING gist (
 *   resource_id WITH =,
 *   tstzrange(starts_at, ends_at, '[)') WITH &&
 * ) WHERE (status IN ('booked', 'checked_in'))
 * ```
 * Garante unicidade no nível de banco — dois bookings simultâneos no mesmo
 * resource no mesmo intervalo são bloqueados pelo Postgres (não dependemos
 * de transação aplicação). Drizzle não suporta EXCLUDE USING gist diretamente
 * — vai em migration SQL inline (`packages/db/src/policies/0017_agenda_rls.sql`).
 *
 * **RLS:** `tenant_id = current_setting('app.tenant_id')::uuid` (regra 1).
 * Scope `company_id`/`unit_id` aplicado em policies via `resources` JOIN
 * (regra 25 — clínico só vê na sua company em franchise).
 *
 * **Materialização lazy de recurring_slots**: slots não vivem no banco como
 * rows pré-geradas. `recurring_slots` é a regra (`rrule` text + start_time +
 * end_time + capacity); `appointments` materializa on-demand quando alguém
 * agenda. Função utility `expandRecurring(range)` calcula slots no Server
 * Action (Sprint 03 Faixa B).
 *
 * **Particionamento**: `appointments` previsão >5M rows/ano em tenant grande
 * (regra 34 + ADR 0072). Particionar por `RANGE (starts_at)` mensal entra
 * em Sprint 04+ quando volume real justificar (MVP cabe sem).
 *
 * @volume_estimate_yearly: 5000000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { companies, units, users } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const resourceKindEnum = pgEnum('resource_kind', [
  'instrutor', // PF profissional (Academia/Fisio/Nutri); FK opcional pra users
  'sala', // Espaço físico (sala de aula, consultório)
  'equipamento', // Bicicleta, esteira, equipamento de pilates — Sprint 03 inicial
])

export const appointmentStatusEnum = pgEnum('appointment_status', [
  'booked', // Confirmado, futuro
  'checked_in', // Member chegou + check-in feito (recepção/catraca Sprint 08)
  'cancelled', // Cancelado por member ou operador
  'no_show', // Member não compareceu (marcado manualmente ou cron Sprint 04+)
  'completed', // Após `ends_at` + check-in (auto-promovido)
])

// ─── resources ───────────────────────────────────────────────────────────
/**
 * Recurso agendável — instrutor, sala ou equipamento.
 *
 * `modality` (text nullable) só preenchido para `kind=instrutor` em vertical
 * Academia (`musculacao` / `coletiva` / `personal`). Sprint 03 — UI filtra
 * por modality. Outros kinds têm `modality=NULL`.
 *
 * `instructor_user_id` (uuid nullable) liga instrutor PF a `users` LogiFit
 * — útil pra integrar com Google Calendar do instrutor (Sprint 03 stretch)
 * e pra auditar quem agendou pra própria agenda.
 *
 * Soft-delete via `archived_at` — instrutor pode sair da empresa mas
 * histórico de appointments permanece. Sem policy DELETE.
 */
export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    kind: resourceKindEnum('kind').notNull(),
    name: text('name').notNull(),
    modality: text('modality'), // 'musculacao' | 'coletiva' | 'personal' (Academia)
    instructorUserId: uuid('instructor_user_id').references(() => users.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('resources_tenant_company_idx').on(t.tenantId, t.companyId),
    index('resources_tenant_kind_idx').on(t.tenantId, t.kind),
    index('resources_instructor_idx').on(t.instructorUserId),
    index('resources_active_idx').on(t.tenantId, t.companyId).where(sql`archived_at IS NULL`),
  ],
)

// ─── recurring_slots ─────────────────────────────────────────────────────
/**
 * Regra de recorrência de slots (RFC 5545 RRULE).
 *
 * Exemplo: "Toda segunda 18h–19h, instrutor X, sala Y, capacidade 12".
 * - `rrule`: text RFC 5545 (`FREQ=WEEKLY;BYDAY=MO;...`)
 * - `start_time` + `end_time`: hora local (sem timezone — interpretada como
 *   wall-clock no fuso do tenant, Sprint 03 Faixa B resolve fuso real)
 * - `capacity`: vagas no slot (1 pra personal, 12 pra aula coletiva, etc)
 * - `active`: flag de pausa temporária (instrutor de férias, sala fechada)
 *
 * Sem `tenant_id` redundante — herda via FK `resource_id → resources.tenant_id`.
 * Mas vamos manter `tenant_id` denormalizado pra performance de RLS policy
 * (evita JOIN no SELECT do filter).
 */
export const recurringSlots = pgTable(
  'recurring_slots',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    rrule: text('rrule').notNull(), // RFC 5545 — ex: 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
    startTime: time('start_time').notNull(), // wall-clock '18:00:00'
    endTime: time('end_time').notNull(), // wall-clock '19:00:00'
    capacity: integer('capacity').notNull().default(1),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recurring_slots_resource_idx').on(t.resourceId),
    index('recurring_slots_tenant_active_idx').on(t.tenantId).where(sql`active = true`),
  ],
)

// ─── appointments ────────────────────────────────────────────────────────
/**
 * Agendamento confirmado (slot materializado).
 *
 * - `recurring_slot_id` nullable: appointment veio de slot recorrente OU é
 *   ad-hoc (operador marcou direto sem rrule)
 * - `status` enum: booked → checked_in → completed (caminho feliz);
 *   booked → cancelled (cancel); booked → no_show (após ends_at)
 *
 * **EXCLUDE constraint** garante unicidade `(resource_id, [starts_at, ends_at))`
 * pra status ativos (`booked` + `checked_in`). Cancelados/no-show/completed
 * podem coexistir no mesmo horário (histórico).
 *
 * Auditoria: `created_by_user_id` (operador que marcou), `cancelled_by_user_id`
 * (quem cancelou). Sprint 04+ amplia.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    recurringSlotId: uuid('recurring_slot_id').references(() => recurringSlots.id, {
      onDelete: 'set null',
    }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: appointmentStatusEnum('status').notNull().default('booked'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('appointments_tenant_starts_idx').on(t.tenantId, t.startsAt),
    index('appointments_tenant_member_starts_idx').on(t.tenantId, t.memberId, t.startsAt),
    index('appointments_resource_starts_idx').on(t.resourceId, t.startsAt),
    index('appointments_status_idx').on(t.tenantId, t.status),
  ],
)

// ─── appointment_waitlist ────────────────────────────────────────────────
/**
 * Lista de espera quando slot recorrente está lotado (`capacity` atingido).
 *
 * PK lógica `(recurring_slot_id, starts_at, member_id)` — mesmo member não
 * pode entrar 2× na waitlist do mesmo slot. Quando alguém cancela, primeiro
 * da fila (oldest `created_at`) vira appointment + emite `waitlist.promoted`
 * (Sprint 03 Faixa B Server Action `cancelAppointment` faz).
 */
export const appointmentWaitlist = pgTable(
  'appointment_waitlist',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    recurringSlotId: uuid('recurring_slot_id')
      .notNull()
      .references(() => recurringSlots.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('appointment_waitlist_uq').on(t.recurringSlotId, t.startsAt, t.memberId),
    index('appointment_waitlist_slot_starts_idx').on(t.recurringSlotId, t.startsAt, t.createdAt),
    index('appointment_waitlist_tenant_member_idx').on(t.tenantId, t.memberId),
  ],
)
