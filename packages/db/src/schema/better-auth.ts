import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// ─── auth_user ────────────────────────────────────────────────────────────
export const authUser = pgTable(
  'auth_user',
  {
    id: text('id').primaryKey(), // BetterAuth gera cuid2/uuid via config
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name'), // pode ser null inicialmente; preenchido pós-OAuth ou cadastro
    image: text('image'), // avatar URL — null no MVP
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('auth_user_email_uq').on(t.email)],
)

// ─── auth_session ─────────────────────────────────────────────────────────
export const authSession = pgTable(
  'auth_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    token: text('token').notNull(), // hash do cookie value
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    // `activeOrganizationId` plugin de organization — não usado MVP
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_session_token_uq').on(t.token),
    index('auth_session_user_id_idx').on(t.userId),
    index('auth_session_expires_at_idx').on(t.expiresAt),
  ],
)

// ─── auth_account ─────────────────────────────────────────────────────────
// Provider: 'credential' (email/senha — não usamos MVP), 'email-otp', 'google', etc.
export const authAccount = pgTable(
  'auth_account',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(), // user_id no provider (Google sub, email, etc.)
    providerId: text('provider_id').notNull(), // 'credential' | 'google' | 'email-otp'
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'), // hash bcrypt — se provider = 'credential'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_account_provider_account_uq').on(t.providerId, t.accountId),
    index('auth_account_user_id_idx').on(t.userId),
  ],
)

// ─── auth_verification ────────────────────────────────────────────────────
// Tokens temporários: magic link, email change, password reset
export const authVerification = pgTable(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(), // email ou similar
    value: text('value').notNull(), // hash do token
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_verification_identifier_idx').on(t.identifier),
    index('auth_verification_expires_at_idx').on(t.expiresAt),
  ],
)

// ─── auth_two_factor (plugin twoFactor) ───────────────────────────────────
export const authTwoFactor = pgTable(
  'auth_two_factor',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(), // TOTP secret cifrado
    backupCodes: text('backup_codes').notNull(), // JSON array de codes one-time
    // Ativo somente após primeiro verify bem-sucedido
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('auth_two_factor_user_uq').on(t.userId)],
)

// ─── auth_passkey (plugin passkey/WebAuthn) ───────────────────────────────
export const authPasskey = pgTable(
  'auth_passkey',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    name: text('name'), // device name escolhido pelo user
    publicKey: text('public_key').notNull(),
    credentialId: text('credential_id').notNull(),
    counter: text('counter').notNull().default('0'), // numeric mas BetterAuth usa text
    deviceType: text('device_type'),
    backedUp: boolean('backed_up').notNull().default(false),
    transports: text('transports'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_passkey_credential_uq').on(t.credentialId),
    index('auth_passkey_user_id_idx').on(t.userId),
  ],
)

export type AuthUserRow = typeof authUser.$inferSelect
export type AuthSessionRow = typeof authSession.$inferSelect
export type AuthAccountRow = typeof authAccount.$inferSelect
export type AuthVerificationRow = typeof authVerification.$inferSelect
