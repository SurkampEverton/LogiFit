/**
 * Passport global identities — Sprint 02b2 (ADR 0093).
 *
 * Identidade global do paciente — pivot SEM tenant_id. Permite paciente ter
 * conta LogiFit antes de vínculo com qualquer tenant clínico (Path B
 * cadastro proativo). Quando paciente aceita invite ou inicia vínculo,
 * `persons.passport_global_identity_id` (nullable FK adicionada via migration
 * 0044) faz bridge entre identidade global e espelho tenant-scoped.
 *
 * **Auth**:
 *   - `password_hash` via scrypt (packages/security/src/password-hash.ts)
 *   - `mfa_totp_secret_encrypted` AES-256-GCM via LOGIFIT_DATA_KEY (ADR 0073)
 *   - `recovery_codes_encrypted` jsonb cifrado com helpers
 *     (packages/security/src/recovery-codes.ts)
 *
 * **LGPD**: tabela é "da pessoa" (não tenant). Art. 18 V (portabilidade) e VI
 * (exclusão) ficam triviais — DPO export função (Sprint 02b3) lê esta row +
 * todas espelho persons via FK.
 *
 * **RLS** (policy `0057_passport_global_identities.sql`):
 *   - Sem tenant_id — RLS por tenant não se aplica
 *   - Visibilidade SELECT: paciente vê o próprio via `app.passport_global_id`
 *   - INSERT pré-auth (Server Action signupPatient — sem session)
 *   - UPDATE só self via `app.passport_global_id` setting
 *   - DPO acesso via permission especial (Sprint 02b3)
 */
import { sql } from 'drizzle-orm'
import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { passportSignupOtps } from './passport-signup'

export const passportGlobalIdentities = pgTable(
  'passport_global_identities',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),

    // ─── Identidade ──────────────────────────────────────────────
    name: text('name').notNull(),
    /** CPF normalizado (só dígitos, 11 chars) — UNIQUE pra evitar contas duplicadas */
    cpfNormalized: text('cpf_normalized').notNull(),
    email: text('email').notNull(),
    /** Telefone E.164 (+5511999999999) — único por entidade mas não globalmente */
    phone: text('phone').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    birthDate: date('birth_date'),
    /** 'male' | 'female' | 'other' | null */
    sex: text('sex'),

    // ─── Auth (scrypt + envelope encryption) ─────────────────────
    /** scrypt format `scrypt$N$r$p$salt_b64$hash_b64` (packages/security/password-hash.ts) */
    passwordHash: text('password_hash').notNull(),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),

    /** MFA opt-in pós-signup via wizard Sprint 02b3 */
    mfaEnrolledAt: timestamp('mfa_enrolled_at', { withTimezone: true }),
    /** AES-256-GCM via LOGIFIT_DATA_KEY (ADR 0073) */
    mfaTotpSecretEncrypted: text('mfa_totp_secret_encrypted'),
    /** jsonb stringified cifrado — array de {hash, used_at} */
    recoveryCodesEncrypted: text('recovery_codes_encrypted'),

    // ─── LGPD aceite (regra 29 + ADR 0054) ───────────────────────
    acceptedTermsAt: timestamp('accepted_terms_at', { withTimezone: true }).notNull(),
    termsVersion: text('terms_version').notNull(),
    acceptedPrivacyAt: timestamp('accepted_privacy_at', { withTimezone: true }).notNull(),
    privacyVersion: text('privacy_version').notNull(),
    /** Versão do RIPD em vigor no momento do signup */
    ripdVersionSignup: text('ripd_version_signup').notNull(),

    // ─── Audit ───────────────────────────────────────────────────
    /** 'proactive' | 'reactive_invite' | 'proactive_then_invite' */
    signupPath: text('signup_path').notNull(),
    signupIp: text('signup_ip'),
    signupUserAgent: text('signup_user_agent'),
    /** FK pra OTP usado no signup (traceability) */
    signupOtpId: uuid('signup_otp_id').references(() => passportSignupOtps.id, {
      onDelete: 'set null',
    }),

    // ─── Lifecycle ───────────────────────────────────────────────
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** Quando paciente desativa conta (LGPD art. 18 VI exclusão) */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    /** 'user_request' | 'lgpd_erasure' | 'fraud' | 'admin_action' */
    deactivatedReason: text('deactivated_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** UNIQUE em cpf_normalized — previne 2 contas mesmo CPF */
    uniqueIndex('passport_global_cpf_uq').on(t.cpfNormalized),
    /** UNIQUE em lower(email) — previne duplicação por case */
    uniqueIndex('passport_global_email_lower_uq').on(sql`lower(${t.email})`),
    /** Lookup por phone (não unique — paciente pode trocar phone) */
    index('passport_global_phone_idx').on(t.phone),
    /** Hot path: identidades ativas */
    index('passport_global_active_idx')
      .on(t.createdAt.desc())
      .where(sql`${t.deactivatedAt} IS NULL`),
    /** Audit FK pro OTP */
    index('passport_global_signup_otp_idx').on(t.signupOtpId),
  ],
)

export type PassportGlobalIdentityRow = typeof passportGlobalIdentities.$inferSelect
export type PassportGlobalIdentityInsert = typeof passportGlobalIdentities.$inferInsert
