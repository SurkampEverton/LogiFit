/**
 * Device Hub — Sprint 32 Faixa A (ADR 0049 esperado).
 *
 * 7 tabelas:
 *   - `device_connections` — OAuth + BLE pairing por (member, provider)
 *   - `device_readings` — leituras brutas (FHIR-like Observation). **PARTIÇÃO DIÁRIA**
 *     (regra 34 + ADR 0072): tabela explode senão (HR minuto-a-minuto = 1440 rows/dia/member).
 *     @volume_estimate_yearly: 180M+. Retenção raw 90d. Sprint 32a entrega single-table
 *     (MVP); particionamento real entra Sprint 32b com primeiro tenant cloud sync.
 *   - `device_readings_daily_summary` — agregado (min/max/avg/count) por dia +
 *     observation_code. Retenção indefinida. Alimenta tendências long-term.
 *   - `device_readings_curated` — leituras que viraram `assessment_measurements`
 *     via curadoria profissional (Uso 1 ADR 0049). Retenção indefinida.
 *   - `device_sync_cursors` — cursor de último sync por connection
 *   - `device_consents` — consent granular por provider + raw_data_access flag
 *   - `device_incidents` — erros (rate limit, token expirado, calibração anômala)
 *
 * **Observation codes** seguem padrão LOINC-inspired (texto livre MVP, enum Sprint 32b):
 *   HR, HR_RESTING, HR_MAX, VO2_MAX, HRV, WEIGHT, BODY_FAT_PCT, MUSCLE_MASS_KG,
 *   SLEEP_DURATION_MIN, SLEEP_EFFICIENCY, STEPS, DISTANCE_KM, CALORIES_KCAL,
 *   READINESS_SCORE, RECOVERY_SCORE, GLUCOSE_MG_DL, VELOCITY_M_S, ROM_DEGREES.
 *
 * **Tokens criptografados via envelope encryption** (Sprint 32b — `LOGIFIT_DATA_KEY`
 *   ADR 0073). MVP grava texto plain com TODO marker.
 *
 * **Curadoria > automação**: dado de dispositivo NUNCA vira medida clínica
 * sem validação humana (regra 28 + ADR 0049). `assessment_measurements.source_device_reading_id`
 * (Sprint 12 — adicionado via migration follow-up) referencia a leitura curada.
 *
 * @volume_estimate_yearly: 180000000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const deviceProviderEnum = pgEnum('device_provider', [
  'garmin',
  'oura',
  'fitbit',
  'apple_health',
  'google_health',
  'ble_scale_omron',
  'ble_scale_gtech',
  'file_import',
  'mock',
])

export const deviceConnectionStatusEnum = pgEnum('device_connection_status', [
  'active',
  'error',
  'revoked',
  'pending', // OAuth iniciado, aguardando callback
])

export const deviceIncidentKindEnum = pgEnum('device_incident_kind', [
  'oauth_failed',
  'token_expired',
  'rate_limited',
  'provider_5xx',
  'parser_failed',
  'calibration_anomaly',
  'duplicate_reading',
  'other',
])

// ─── device_connections ─────────────────────────────────────────────────

export const deviceConnections = pgTable(
  'device_connections',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    provider: deviceProviderEnum('provider').notNull(),
    /** Encrypted via envelope (Sprint 32b); TODO MVP grava texto */
    accessTokenEncrypted: text('access_token_encrypted'),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** ID do user no provider (Garmin userid, Oura user_id) */
    externalUserId: text('external_user_id'),
    /** BLE device serial number quando aplicável */
    deviceSerial: text('device_serial'),
    /** Label legível ("Garmin Forerunner 255", "Omron HBF-226") */
    deviceLabel: text('device_label'),
    status: deviceConnectionStatusEnum('status').notNull().default('pending'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Metadata flexível por provider */
    metadata: jsonb('metadata'),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Lookup quente: connections do member (UI /meu/dispositivos) */
    index('device_conn_member_idx').on(t.memberId, t.status),
    /** Lookup nutri/staff (/app/members/[id]/dispositivos) */
    index('device_conn_tenant_member_idx').on(t.tenantId, t.memberId),
    /** Job sync horário — connections active */
    index('device_conn_active_sync_idx')
      .on(t.lastSyncedAt)
      .where(sql`status = 'active'`),
    /** Único provider active por member */
    uniqueIndex('device_conn_member_provider_active_uq')
      .on(t.memberId, t.provider)
      .where(sql`status IN ('active', 'pending')`),
  ],
)

// ─── device_readings (leituras brutas) ──────────────────────────────────
/**
 * Padrão FHIR Observation lite. Sprint 32a entrega single-table (MVP);
 * particionamento diário (`PARTITION BY RANGE (measured_at)`) entra Sprint 32b
 * via migration manual SQL com retenção 90d.
 */
export const deviceReadings = pgTable(
  'device_readings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => deviceConnections.id, { onDelete: 'cascade' }),
    /** LOINC-inspired text (Sprint 32b vira enum dedicado) */
    observationCode: text('observation_code').notNull(),
    value: numeric('value', { precision: 12, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
    sourceProvider: deviceProviderEnum('source_provider').notNull(),
    /** ID do dispositivo no provider (Garmin device_uuid) */
    sourceDeviceId: text('source_device_id'),
    /** Quality flag: 'high' | 'medium' | 'low' | 'estimated' */
    quality: text('quality'),
    /** Payload bruto pro audit (jsonb pequeno; sem PII além do já em colunas) */
    metadata: jsonb('metadata'),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Lookup quente: leituras recentes do member por código (UI gráficos) */
    index('device_readings_member_code_idx').on(t.memberId, t.observationCode, t.measuredAt.desc()),
    /** Range por tenant (admin panel) */
    index('device_readings_tenant_at_idx').on(t.tenantId, t.measuredAt.desc()),
    /** Sync job: dedup por (connection, observation_code, measured_at) */
    uniqueIndex('device_readings_dedup_uq').on(t.connectionId, t.observationCode, t.measuredAt),
    check('device_readings_value_finite', sql`${t.value} IS NOT NULL`),
  ],
)

// ─── device_readings_daily_summary ───────────────────────────────────────
/**
 * Agregação diária por (tenant, member, observation_code, date). Cron 02:00
 * SP popula a partir de device_readings antes do drop diário (Sprint 32b).
 *
 * Retenção indefinida — base do Uso 2 (Painel monitoramento contínuo).
 */
export const deviceReadingsDailySummary = pgTable(
  'device_readings_daily_summary',
  {
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    observationCode: text('observation_code').notNull(),
    observedDate: date('observed_date').notNull(),
    /** Stats */
    minValue: numeric('min_value', { precision: 12, scale: 3 }).notNull(),
    maxValue: numeric('max_value', { precision: 12, scale: 3 }).notNull(),
    avgValue: numeric('avg_value', { precision: 12, scale: 3 }).notNull(),
    samplesCount: numeric('samples_count', { precision: 7, scale: 0 }).notNull(),
    unit: text('unit').notNull(),
    sourceProvider: deviceProviderEnum('source_provider'),
    aggregatedAt: timestamp('aggregated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.memberId, t.observationCode, t.observedDate] }),
    /** Lookup quente: tendências long-term */
    index('device_readings_summary_member_code_idx').on(
      t.memberId,
      t.observationCode,
      t.observedDate.desc(),
    ),
    check('device_readings_summary_min_max', sql`${t.minValue} <= ${t.maxValue}`),
  ],
)

// ─── device_readings_curated ─────────────────────────────────────────────
/**
 * Leituras curadas pelo profissional (Uso 1 ADR 0049). Snapshot da leitura
 * bruta no momento da validação — sobrevive ao drop diário das partições raw.
 *
 * `assessment_measurements.source_device_reading_id` referencia ESTE id (não
 * o id da `device_readings` original que pode ter sido dropado).
 */
export const deviceReadingsCurated = pgTable(
  'device_readings_curated',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** ID original da leitura bruta (FK lógica; pode estar dropada) */
    originalReadingId: uuid('original_reading_id'),
    observationCode: text('observation_code').notNull(),
    value: numeric('value', { precision: 12, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
    sourceProvider: deviceProviderEnum('source_provider').notNull(),
    sourceDeviceId: text('source_device_id'),
    /** Quem curou (audit) */
    curatedByUserId: uuid('curated_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    curatedAt: timestamp('curated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Comentário do profissional na validação (ex: "BIA pós-treino, ajustar tara") */
    curationNotes: text('curation_notes'),
    /** Valor editado pelo profissional (≠ value original) — dispara warning visual */
    valueEdited: boolean('value_edited').notNull().default(false),
    metadata: jsonb('metadata'),
  },
  (t) => [
    index('device_readings_curated_member_idx').on(t.memberId, t.measuredAt.desc()),
    index('device_readings_curated_tenant_idx').on(t.tenantId, t.curatedAt.desc()),
    index('device_readings_curated_original_idx').on(t.originalReadingId),
  ],
)

// ─── device_sync_cursors ─────────────────────────────────────────────────

export const deviceSyncCursors = pgTable('device_sync_cursors', {
  connectionId: uuid('connection_id')
    .primaryKey()
    .references(() => deviceConnections.id, { onDelete: 'cascade' }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  /** Cursor opaco do provider (timestamp, nextPageToken, etc.) */
  cursorPayload: jsonb('cursor_payload'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── device_consents ─────────────────────────────────────────────────────

export const deviceConsents = pgTable(
  'device_consents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    provider: deviceProviderEnum('provider').notNull(),
    /** Finalidades autorizadas (texto livre): 'academia_hr', 'nutri_weight', 'fisio_rom', etc. */
    purposes: text('purposes').array().notNull().default(sql`'{}'::text[]`),
    /** Permite leitura de dado cru (HR minuto-a-minuto), exige permission `devices.read_raw` */
    rawDataAccessGranted: boolean('raw_data_access_granted').notNull().default(false),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Versão da RIPD que vigorou (regra 29) */
    ripdVersion: text('ripd_version'),
    sourceIp: text('source_ip'),
  },
  (t) => [
    /** 1 consent ativo por (member, provider) */
    uniqueIndex('device_consents_active_uq')
      .on(t.memberId, t.provider)
      .where(sql`revoked_at IS NULL`),
    index('device_consents_member_idx').on(t.memberId, t.grantedAt.desc()),
  ],
)

// ─── device_incidents ────────────────────────────────────────────────────

export const deviceIncidents = pgTable(
  'device_incidents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    connectionId: uuid('connection_id').references(() => deviceConnections.id, {
      onDelete: 'cascade',
    }),
    kind: deviceIncidentKindEnum('kind').notNull(),
    summary: text('summary').notNull(),
    details: jsonb('details'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('device_incidents_tenant_at_idx').on(t.tenantId, t.occurredAt.desc()),
    index('device_incidents_connection_idx').on(t.connectionId, t.occurredAt.desc()),
    index('device_incidents_open_idx')
      .on(t.tenantId, t.occurredAt.desc())
      .where(sql`resolved_at IS NULL`),
  ],
)

export type DeviceConnectionRow = typeof deviceConnections.$inferSelect
export type DeviceReadingRow = typeof deviceReadings.$inferSelect
export type DeviceReadingsDailySummaryRow = typeof deviceReadingsDailySummary.$inferSelect
export type DeviceReadingsCuratedRow = typeof deviceReadingsCurated.$inferSelect
export type DeviceSyncCursorRow = typeof deviceSyncCursors.$inferSelect
export type DeviceConsentRow = typeof deviceConsents.$inferSelect
export type DeviceIncidentRow = typeof deviceIncidents.$inferSelect
