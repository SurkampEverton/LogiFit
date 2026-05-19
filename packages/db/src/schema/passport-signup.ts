/**
 * Passport signup OTPs — Sprint 02b Path B (cadastro proativo `/cadastro`).
 *
 * Tabela armazena OTPs SMS pendentes na etapa 1 do cadastro proativo
 * (paciente novo sem tenant clínico). Sem `tenant_id` nem `member_id` —
 * pré-auth global.
 *
 * Fluxo:
 *   1. Paciente em `/cadastro` digita telefone + resolve Turnstile
 *   2. `requestSmsCode({phone, captchaToken})` → grava `passport_signup_otps`
 *      com `code_hash` (SHA-256) + `expires_at` (now + 5min) + envia SMS
 *   3. Paciente recebe SMS + digita código + dados completos (nome, CPF, email, senha)
 *   4. `verifySmsCode({phone, code})` valida hash + expires + marca `used_at`
 *   5. `signupPatient({...})` cria identidade global (Sprint 02b2 — depende
 *      ADR persons-without-tenant)
 *
 * **Sem RLS** — tabela pré-auth global. Acesso direto via `pool.query`.
 *
 * **Retenção**: cleanup automático após 24h via cron job (Sprint 02b2 —
 * `expire-passport-signup-otps`). OTPs `used_at` ficam pra audit por 30d.
 */
import { sql } from 'drizzle-orm'
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const passportSignupOtps = pgTable(
  'passport_signup_otps',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Telefone E.164 (+5511999999999) — único pra lookup */
    phone: text('phone').notNull(),
    /** SHA-256 do código OTP de 6 dígitos (nunca grava plain) */
    codeHash: text('code_hash').notNull(),
    /** TTL — default 5min após createdAt */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Marcado quando código é verificado com sucesso */
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** Contador de tentativas de verify falhadas (rate limit por OTP) */
    attempts: integer('attempts').notNull().default(0),
    /** IP do request (audit + rate limit por IP) */
    requestIp: text('request_ip'),
    /** Provider que enviou o SMS (twilio/mock) */
    smsProvider: text('sms_provider'),
    /** SID do SMS no provider (audit) */
    smsMessageSid: text('sms_message_sid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Lookup quente: OTP mais recente pra um telefone */
    index('passport_signup_otps_phone_idx').on(t.phone, t.createdAt.desc()),
    /** Cleanup job: encontra expirados */
    index('passport_signup_otps_expires_idx').on(t.expiresAt),
  ],
)

export type PassportSignupOtpRow = typeof passportSignupOtps.$inferSelect
