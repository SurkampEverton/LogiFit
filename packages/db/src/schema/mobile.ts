/**
 * Mobile App Nativo — Sprint 35 Faixa A (ADRs 0045+0046 esperados).
 *
 * 3 tabelas:
 *   - `mobile_app_versions` — registry de versões publicadas (iOS + Android) +
 *     `min_required_version` pra forçar update.
 *   - `mobile_push_tokens` — APNs (iOS) + FCM (Android) tokens por member device.
 *   - `mobile_sessions` — sessões nativas distintas das web (refresh longo + device fingerprint).
 *
 * **Backbone Sprint 35a**: schema + API + Server Actions prontos pra Expo project
 *   (Sprint 35b) consumir sem refactor. App nativo é cliente puro — toda lógica
 *   server-side já existe.
 *
 * **Push notification flow**:
 *   1. App boot pede permissão notificação (iOS prompt, Android auto)
 *   2. Recebe APNs/FCM token do SO
 *   3. POST `/api/mobile/auth/register-push` com token + platform + version
 *   4. Servidor grava em `mobile_push_tokens` linkado a member_id
 *   5. Server-side dispara push via APNs/FCM provider (Sprint 35b) usando token
 *
 * **Versioning + EOL**:
 *   - `mobile_app_versions` mantém todas versões publicadas
 *   - `min_required_version` por platform força update (app verifica em boot)
 *   - Versão fora do range válido → tela bloqueante "Atualize para continuar"
 *
 * @volume_estimate_yearly: 1200000
 *   (1k tenants × 1k members × 1.2 devices/member × 1 push registration/mês)
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const mobilePlatformEnum = pgEnum('mobile_platform', ['ios', 'android'])

export const mobileSessionStatusEnum = pgEnum('mobile_session_status', [
  'active',
  'revoked',
  'expired',
])

// ─── mobile_app_versions ─────────────────────────────────────────────────
/**
 * Registry de versões publicadas. Global (sem tenant_id) — uma versão do app
 * vale pra todos os tenants. `published_at` quando vai pra app store; `min_required`
 * pra forçar update.
 */
export const mobileAppVersions = pgTable(
  'mobile_app_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    platform: mobilePlatformEnum('platform').notNull(),
    /** Semver completo: '1.2.3' */
    version: text('version').notNull(),
    /** Build number monotônico (iOS CFBundleVersion / Android versionCode) */
    buildNumber: text('build_number').notNull(),
    /** URL da app store pra download */
    storeUrl: text('store_url'),
    /** Notes de release */
    releaseNotes: text('release_notes'),
    /** Versão mínima exigida — apps < esta versão veem tela bloqueante */
    minRequired: boolean('min_required').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    /** Quando true, app store já recolheu (sunset) — não recomenda mais */
    sunset: boolean('sunset').notNull().default(false),
    sunsetAt: timestamp('sunset_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mobile_app_versions_platform_version_uq').on(t.platform, t.version),
    index('mobile_app_versions_published_idx').on(t.platform, t.publishedAt.desc()),
    /** Lookup quente: versão mínima exigida atual */
    index('mobile_app_versions_min_required_idx')
      .on(t.platform, t.publishedAt.desc())
      .where(sql`min_required = true`),
  ],
)

// ─── mobile_push_tokens ──────────────────────────────────────────────────

export const mobilePushTokens = pgTable(
  'mobile_push_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    platform: mobilePlatformEnum('platform').notNull(),
    /** APNs token (iOS) ou FCM token (Android) */
    token: text('token').notNull(),
    /** Device identifier opaco fornecido pelo app (não vinculado a user) */
    deviceId: text('device_id'),
    /** Modelo do device pra UI mostrar ("iPhone 13", "Pixel 7", etc) */
    deviceModel: text('device_model'),
    /** OS version */
    osVersion: text('os_version'),
    /** Versão do app que registrou */
    appVersion: text('app_version'),
    /** Locale do device (pt-BR, en-US) */
    locale: text('locale'),
    /** Soft-revoke: NULL = ativo */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'), // 'user_logout' | 'token_invalid' | 'device_removed'
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** 1 token ativo por (member, device_id) — re-register substitui */
    uniqueIndex('mobile_push_tokens_member_device_active_uq')
      .on(t.memberId, t.deviceId, t.platform)
      .where(sql`revoked_at IS NULL`),
    /** Lookup quente: push dispatcher pega ativos por member */
    index('mobile_push_tokens_member_active_idx')
      .on(t.memberId, t.platform)
      .where(sql`revoked_at IS NULL`),
    index('mobile_push_tokens_tenant_idx').on(t.tenantId, t.lastUsedAt.desc()),
  ],
)

// ─── mobile_sessions ─────────────────────────────────────────────────────
/**
 * Sessões nativas distintas das web (`member_sessions` Sprint 26). Por quê:
 *   - Refresh longo (90d vs 30d web) — usuário não faz login toda hora
 *   - Device fingerprint pra detectar roubo
 *   - Single sign-out por device (não invalida web)
 *   - Cookie web tem path=/meu; app usa Bearer token na API
 *
 * **Tokens curtos (access 1h) + refresh longos (90d)** — App refresca em
 * background sem incomodar usuário.
 */
export const mobileSessions = pgTable(
  'mobile_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    platform: mobilePlatformEnum('platform').notNull(),
    /** SHA-256 do refresh token plano (token plano só circula no boot) */
    refreshTokenHash: text('refresh_token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Device fingerprint opaco: deviceId + osVersion + model hash */
    deviceFingerprint: text('device_fingerprint'),
    /** Para UI "dispositivos conectados" */
    deviceLabel: text('device_label'),
    /** Versão do app que criou a sessão */
    appVersion: text('app_version'),
    /** IP visto na criação */
    createdIp: text('created_ip'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenIp: text('last_seen_ip'),
    status: mobileSessionStatusEnum('status').notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mobile_sessions_refresh_hash_uq').on(t.refreshTokenHash),
    index('mobile_sessions_member_active_idx')
      .on(t.memberId, t.platform)
      .where(sql`status = 'active'`),
    check(
      'mobile_sessions_revoked_consistency',
      sql`(status != 'revoked' OR revoked_at IS NOT NULL)`,
    ),
  ],
)

export type MobileAppVersionRow = typeof mobileAppVersions.$inferSelect
export type MobilePushTokenRow = typeof mobilePushTokens.$inferSelect
export type MobileSessionRow = typeof mobileSessions.$inferSelect

void jsonb // silence
