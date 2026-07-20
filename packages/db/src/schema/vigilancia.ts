/**
 * Vigilância Sanitária — ANVISA + Limpeza — Sprint 25 Faixa A.
 *
 * 5 tabelas:
 *   - equipment — cadastro por company/unit + fabricante + modelo + serial
 *   - equipment_maintenance — cronograma + execução + certificado anexado +
 *     fluxo manutenção externa (NF-e remessa 5.915 + retorno 1.916)
 *   - equipment_usage_log — rastreabilidade clínica (qual paciente usou qual aparelho)
 *   - cleaning_checklists — templates por ambiente
 *   - cleaning_logs — registro diário com items_done jsonb
 *
 * **Sem ADR novo** — schemas triviais; cronograma e CNES não exigem nova
 * decisão arquitetural.
 *
 * **CNES (Cadastro Nacional de Estabelecimentos de Saúde)** — número de 7
 * dígitos atribuído pelo Datasus a cada estabelecimento de saúde regulado.
 * Armazenado em `companies.cnes_code` via migration manual; sync com base
 * pública é stretch.
 *
 * **Particionamento `equipment_usage_log`** (regra 34 + ADR 0072):
 *   - 1k tenants × 10 equips × 5 usos/dia × 365 = 18M+ linhas/ano
 *   - PARTITION BY RANGE (used_at) trimestral via migration manual
 *   - Retenção 5a fiscal (ANVISA fiscalização)
 *
 * @volume_estimate_yearly: 18000000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { appointments } from './agenda'
import { companies, units, users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const equipmentStatusEnum = pgEnum('equipment_status', [
  'active', // em uso
  'maintenance', // em manutenção (interna ou externa)
  'decommissioned', // baixado / descartado
])

export const equipmentKindEnum = pgEnum('equipment_kind', [
  'ultrassom',
  'tens',
  'laser',
  'crioterapia',
  'eletroestimulacao',
  'esteira',
  'bicicleta',
  'balanca_bioimpedancia',
  'pressao_arterial',
  'glicosimetro',
  'oximetro',
  'outro',
])

export const maintenanceKindEnum = pgEnum('maintenance_kind', [
  'preventive', // manutenção preventiva
  'calibration', // calibração obrigatória (ex: bioimpedância anual)
  'corrective', // conserto de falha
])

export const maintenanceStatusEnum = pgEnum('maintenance_status', [
  'scheduled', // agendada
  'in_transit_to_external', // saiu para conserto externo
  'at_external', // no fornecedor
  'returning', // voltando
  'completed', // finalizada
  'overdue', // vencida sem execução
  'cancelled',
])

// ─── equipment ──────────────────────────────────────────────────────────

export const equipment = pgTable(
  'equipment',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    kind: equipmentKindEnum('kind').notNull(),
    manufacturer: text('manufacturer').notNull(),
    model: text('model').notNull(),
    serialNumber: text('serial_number').notNull(),
    /** Registro ANVISA quando aplicável (ex: 100015410001) */
    anvisaRegistration: text('anvisa_registration'),
    acquiredAt: date('acquired_at').notNull(),
    warrantyUntil: date('warranty_until'),
    status: equipmentStatusEnum('status').notNull().default('active'),
    /** Periodicidade default em dias (180 = semestral; 365 = anual) */
    maintenanceIntervalDays: integer('maintenance_interval_days'),
    calibrationIntervalDays: integer('calibration_interval_days'),
    /** Data da última manutenção concluída (cached para alerta D-30/D-7) */
    lastMaintenanceAt: date('last_maintenance_at'),
    lastCalibrationAt: date('last_calibration_at'),
    notes: text('notes'),
    decommissionedAt: timestamp('decommissioned_at', { withTimezone: true }),
    decommissionedReason: text('decommissioned_reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('eq_serial_global_uq').on(t.manufacturer, t.serialNumber),
    index('eq_tenant_company_idx')
      .on(t.tenantId, t.companyId)
      .where(sql`status != 'decommissioned'`),
    index('eq_tenant_status_idx').on(t.tenantId, t.status),
    index('eq_kind_idx').on(t.tenantId, t.kind),
    check(
      'eq_intervals_positive',
      sql`(maintenance_interval_days IS NULL OR maintenance_interval_days > 0)
       AND (calibration_interval_days IS NULL OR calibration_interval_days > 0)`,
    ),
  ],
)

// ─── equipment_maintenance ──────────────────────────────────────────────

export const equipmentMaintenance = pgTable(
  'equipment_maintenance',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id, { onDelete: 'restrict' }),
    kind: maintenanceKindEnum('kind').notNull(),
    plannedFor: date('planned_for').notNull(),
    performedAt: date('performed_at'),
    performedByText: text('performed_by'),
    /** Chave no bucket de certificados (Sprint 25b com MinIO real) */
    certificateStoragePath: text('certificate_storage_path'),
    certificateContentHash: text('certificate_content_hash'),
    costCents: bigint('cost_cents', { mode: 'number' }),
    observations: text('observations'),
    status: maintenanceStatusEnum('status').notNull().default('scheduled'),
    /** True = equipamento sai do tenant pra conserto externo (exige NF-e remessa 5.915) */
    externalLocation: boolean('external_location').notNull().default(false),
    /** Sprint 25b: linka com suppliers + fiscal_emissions (ADR 0059) */
    externalSupplierId: uuid('external_supplier_id'),
    /** NF-e de remessa pra conserto (Sprint 36 ADR 0059) — placeholder por enquanto */
    nfeShippingEmissionId: uuid('nfe_shipping_emission_id'),
    /** NF-e de retorno do conserto */
    nfeReturnEmissionId: uuid('nfe_return_emission_id'),
    externalDepartedAt: timestamp('external_departed_at', { withTimezone: true }),
    externalReturnedAt: timestamp('external_returned_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('em_equipment_planned_idx').on(t.equipmentId, t.plannedFor),
    index('em_tenant_status_idx').on(t.tenantId, t.status, t.plannedFor),
    index('em_overdue_idx').on(t.plannedFor).where(sql`status IN ('scheduled', 'overdue')`),
    check('em_completed_consistent', sql`(status != 'completed' OR performed_at IS NOT NULL)`),
    check(
      'em_external_consistent',
      sql`(external_location = false OR external_supplier_id IS NOT NULL)`,
    ),
  ],
)

// ─── equipment_usage_log ────────────────────────────────────────────────
/**
 * Append-only. Rastreabilidade clínica obrigatória ANVISA — saber qual
 * paciente usou qual aparelho em qual horário (especialmente equipamentos
 * Classe III/IV: laser, ultrassom focalizado).
 */
export const equipmentUsageLog = pgTable(
  'equipment_usage_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    equipmentId: uuid('equipment_id')
      .notNull()
      .references(() => equipment.id, { onDelete: 'restrict' }),
    /** Vínculo opcional — pode existir uso sem appointment (limpeza/teste) */
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    /** Sprint 25b: linka com consultas/evolucoes (Sprint 20/21) — placeholder */
    consultaId: uuid('consulta_id'),
    evolucaoId: uuid('evolucao_id'),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
    usedByUserId: uuid('used_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Duração em minutos (opcional, alguns equips registram tempo de aplicação) */
    durationMinutes: integer('duration_minutes'),
    /** Parâmetros do uso (intensidade laser/ultrassom; frequência TENS) */
    parameters: jsonb('parameters'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('eul_equipment_idx').on(t.equipmentId, t.usedAt),
    index('eul_tenant_used_at_idx').on(t.tenantId, t.usedAt),
    index('eul_appointment_idx').on(t.appointmentId).where(sql`appointment_id IS NOT NULL`),
    check('eul_duration_positive', sql`(duration_minutes IS NULL OR duration_minutes > 0)`),
  ],
)

// ─── cleaning_checklists ────────────────────────────────────────────────

export const cleaningChecklists = pgTable(
  'cleaning_checklists',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /** Array de { key, label, required boolean } */
    items: jsonb('items').notNull(),
    /** Frequência mínima (1=diária, 7=semanal, etc) — alerta se passar */
    frequencyDays: integer('frequency_days').notNull().default(1),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cc_tenant_company_idx').on(t.tenantId, t.companyId).where(sql`active = true`),
    check('cc_frequency_positive', sql`frequency_days > 0`),
  ],
)

// ─── cleaning_logs ──────────────────────────────────────────────────────
/**
 * Append-only. Registro diário de limpeza. UI mobile-first pra equipe usar
 * no celular. itemsDone jsonb = subset das keys do checklist + observações
 * por item.
 */
export const cleaningLogs = pgTable(
  'cleaning_logs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    checklistId: uuid('checklist_id')
      .notNull()
      .references(() => cleaningChecklists.id, { onDelete: 'restrict' }),
    performedByUserId: uuid('performed_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Array de keys cumpridas: ['alcool_70', 'descarte_perfurocortantes', 'troca_lencois'] */
    itemsDone: jsonb('items_done').notNull(),
    /** Percentual concluído calculado pela lib (lib pura) */
    completionPct: integer('completion_pct'),
    /** True = todos itens required cumpridos */
    isComplete: boolean('is_complete').notNull().default(false),
    observations: text('observations'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cl_checklist_performed_idx').on(t.checklistId, t.performedAt),
    index('cl_tenant_company_idx').on(t.tenantId, t.companyId, t.performedAt),
    index('cl_complete_idx').on(t.tenantId, t.isComplete),
    check(
      'cl_completion_pct_range',
      sql`(completion_pct IS NULL OR (completion_pct >= 0 AND completion_pct <= 100))`,
    ),
  ],
)

void uuid
