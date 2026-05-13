/**
 * Academia · Controle de acesso — Sprint 08 Faixa A (ADR 0017 + 0018 esperados).
 *
 * 4 tabelas core:
 *   - `access_devices` (catraca/iPad/Android cadastrado por unit)
 *   - `access_secrets` (HMAC secret por tenant, rotativo)
 *   - `access_events` (check-ins/denials — append-only)
 *   - `access_blocks` (manual ou automático overdue/suspended)
 *
 * **Facial recognition** (`member_face_embeddings` + pgvector) **adiado pra
 * Sprint 09+**: depende ADR 0018 fechar (hardware) + consent LGPD biometria
 * específico (RIPD biometria assinado pelo DPO antes de prod).
 *
 * **Particionamento `access_events`**: previsão >5M rows/ano em academia
 * grande (regra 34 + ADR 0072). Sprint 09+ adiciona PARTITION BY RANGE
 * (at) mensal. MVP cabe sem.
 *
 * **HMAC QR**: helper `generateAccessToken(memberId, tenantSecret)` em
 * `packages/security/access-qr.ts` (Sprint 08 Faixa B). Rotação 60s tolerância
 * 1 ciclo (member levanta QR, atrasa 30s na catraca — aceita).
 *
 * @volume_estimate_yearly: 5000000
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
import { companies, units } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const accessEventKindEnum = pgEnum('access_event_kind', [
  'checkin',
  'checkout',
  'denied_overdue', // overdue invoice (Sprint 04 dispatch)
  'denied_block', // manual / suspended block
  'denied_invalid_token', // QR HMAC inválido
  'denied_no_face_match', // facial mismatch (Sprint 09+)
  'denied_no_consent', // member não consentiu biometria
  'manual', // recepção registrou manualmente
])

export const accessAuthModeEnum = pgEnum('access_auth_mode', [
  'qr',
  'facial',
  'manual',
])

export const accessBlockKindEnum = pgEnum('access_block_kind', [
  'manual', // operador bloqueou manualmente (ex: aluno suspenso por má conduta)
  'overdue', // dispatcher Sprint 04 invoice.overdue
  'suspended', // contract.paused/auto_paused
])

// ─── access_devices ──────────────────────────────────────────────────────
/**
 * Catraca/iPad/Android cadastrado por unit.
 *
 * `token_hash`: bcrypt do device_token (mostrado 1× no register). Catraca usa
 * token em `POST /api/acesso/checkin` header `x-device-token`.
 *
 * `auth_modes`: array text. MVP `['qr']`. Sprint 09+ adiciona `'facial'`.
 *
 * `last_heartbeat`: catraca chama `POST /api/acesso/heartbeat` cada 30s.
 * Job `check-device-heartbeat` (Sprint 08 Faixa C) alerta se silêncio >2min.
 */
export const accessDevices = pgTable(
  'access_devices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull(),
    authModes: jsonb('auth_modes').notNull(), // array text
    hardwareType: text('hardware_type'), // 'android-box' | 'ipad-relay' | 'esp32-camera' | etc
    lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('access_devices_tenant_unit_idx').on(t.tenantId, t.unitId),
    index('access_devices_active_idx')
      .on(t.tenantId, t.companyId)
      .where(sql`revoked_at IS NULL`),
  ],
)

// ─── access_secrets ──────────────────────────────────────────────────────
/**
 * HMAC secret por tenant pra gerar/validar QR tokens.
 *
 * Rotação periódica (Sprint 08 Faixa C cron). QR tokens são válidos se HMAC
 * bater com qualquer `active=true` das últimas 2 rotações — tolerância
 * pra clock drift entre celular do member e catraca.
 *
 * `secret` é bytea (32 bytes random). Sprint 09+ envelope encryption via
 * `LOGIFIT_DATA_KEY`.
 */
export const accessSecrets = pgTable(
  'access_secrets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    secret: text('secret').notNull(), // base64 de 32 bytes
    active: boolean('active').notNull().default(true),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('access_secrets_tenant_active_idx')
      .on(t.tenantId)
      .where(sql`active = true`),
  ],
)

// ─── access_events (append-only) ────────────────────────────────────────
/**
 * Cada tentativa de check-in/out. Resultado em `kind`. `raw jsonb` guarda
 * payload completo (auditoria forense).
 *
 * Append-only via policies (sem UPDATE/DELETE). Particionamento Sprint 09+
 * por `at` mensal.
 */
export const accessEvents = pgTable(
  'access_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id').references(() => accessDevices.id, { onDelete: 'set null' }),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: accessEventKindEnum('kind').notNull(),
    authMode: accessAuthModeEnum('auth_mode').notNull(),
    appointmentId: uuid('appointment_id'), // FK pra appointments quando bate em aula (Sprint 03)
    raw: jsonb('raw'), // device_token redacted, qr_token_prefix, ip, user_agent etc
  },
  (t) => [
    index('access_events_tenant_at_idx').on(t.tenantId, t.at),
    index('access_events_member_at_idx').on(t.memberId, t.at),
    index('access_events_device_at_idx').on(t.deviceId, t.at),
    // Enum não aceita LIKE — usa IN explícito (todos os denied_*)
    index('access_events_denied_idx')
      .on(t.tenantId, t.at)
      .where(
        sql`kind IN ('denied_overdue', 'denied_block', 'denied_invalid_token', 'denied_no_face_match', 'denied_no_consent')`,
      ),
  ],
)

// ─── access_blocks ──────────────────────────────────────────────────────
/**
 * Bloqueio temporário ou definitivo. 3 origens:
 *   - `manual`: operador clica "Bloquear" em /app/acesso/bloqueios
 *   - `overdue`: dispatcher Sprint 04 detecta invoice.overdue > grace period
 *   - `suspended`: contract.paused (trancamento academia)
 *
 * `expires_at NULL` = indefinido (até resolved_at). `resolved_at` quando admin
 * desbloqueia OU dispatcher resolve (payment.received para overdue).
 */
export const accessBlocks = pgTable(
  'access_blocks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    kind: accessBlockKindEnum('kind').notNull(),
    reason: text('reason').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedReason: text('resolved_reason'),
    sourceInvoiceId: uuid('source_invoice_id'), // FK lógica para invoices (sem FK estrita)
    sourceContractId: uuid('source_contract_id'), // FK lógica para contracts
    createdByUserId: uuid('created_by_user_id'),
  },
  (t) => [
    index('access_blocks_tenant_member_idx').on(t.tenantId, t.memberId),
    index('access_blocks_active_idx')
      .on(t.tenantId, t.memberId)
      .where(sql`resolved_at IS NULL`),
    check(
      'access_blocks_resolved_consistency',
      sql`(resolved_at IS NULL AND resolved_reason IS NULL) OR (resolved_at IS NOT NULL AND resolved_reason IS NOT NULL)`,
    ),
  ],
)
