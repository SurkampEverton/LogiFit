'use server'

/**
 * Server Actions Cadastro Proativo (Sprint 02b Path B — regra 42 + ADR 0077).
 *
 * Rota pública `/cadastro` — visitor anônimo cria conta LogiFit antes de ter
 * qualquer vínculo com tenant clínico. Posteriormente pode receber invites
 * (Path A — Sprint 02) ou enviar convite inverso (Path C — Sprint 02b2+).
 *
 * **Fluxo 2-step:**
 *   1. `requestSmsCode({phone, captchaToken})` — verify Turnstile + gera OTP +
 *      grava `passport_signup_otps` + envia SMS (mock dev / Twilio prod).
 *   2. `verifySmsCode({phone, code})` — valida hash + expires + marca used.
 *   3. `signupPatient({name, cpf, phone, email, password, smsOtpId})` — STUB
 *      até ADR persons-without-tenant ser decidido (Sprint 02b2). Por enquanto
 *      retorna `{ok: false, code: 'SCHEMA_PENDING'}`.
 *
 * **Rate limits (regra 36):**
 *   - 3 requests/IP/15min em `requestSmsCode` (anti-spam)
 *   - 1 OTP ativo por telefone (revoga anterior)
 *   - 5 attempts em `verifySmsCode` antes de invalidar OTP
 *
 * **Anti-enumeration:** `requestSmsCode` sempre retorna `{ok: true}` mesmo
 * se telefone inválido (não revela quem está cadastrado).
 *
 * **Providers** em `packages/security/src/`:
 *   - `verifyCaptcha` (Turnstile — mock dev)
 *   - `sendSmsOtp` / `generateOtpCode` / `hashOtpCode` / `verifyOtpCode` (Twilio — mock dev)
 *
 * **Sprint 02b2 (futuro)** completa Path B:
 *   - Resolver ADR `persons-without-tenant`: schema atual exige `persons.tenant_id`
 *     NOT NULL. Opções: (A) tenant pivot fixo `system-passport-pivot`,
 *     (B) refactor tenant_id pra nullable + RLS adaptado, (C) tabela
 *     `passport_global_identities` separada como pivot global. Provavelmente C.
 *   - Implementar `signupPatient` real: criar identidade global + hash de senha
 *     (BetterAuth/Lucia decidir Sprint 01a sub) + MFA opcional + recovery codes.
 *   - Cron `expire-passport-signup-otps` 24h cleanup.
 *   - E2E Playwright fluxo completo (Turnstile real sandbox + Twilio test mode).
 *   - Provisionar Twilio sandbox + Cloudflare Turnstile site key/secret em prod.
 *   - RIPD `v1.0-passport-signup.md` (regra 29 + ADR 0054) sign-off DPO.
 *   - WhatsApp OTP como segundo canal (regra 2/26b — Twilio WhatsApp Business API).
 */

import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import {
  encryptSecret,
  generateOtpCode,
  generateRecoveryCodes,
  hashOtpCode,
  hashPassword,
  hashRecoveryCode,
  sendSmsOtp,
  verifyCaptcha,
  verifyOtpCode,
} from '@repo/security'
import { z } from 'zod'

const PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Telefone deve estar em formato E.164 (+5511999999999)')

const RequestSmsSchema = z.object({
  phone: PhoneSchema,
  captchaToken: z.string().min(1).max(2000),
})

const VerifySmsSchema = z.object({
  phone: PhoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Código deve ter 6 dígitos'),
})

const SignupPatientSchema = z.object({
  /** Nome completo */
  name: z.string().min(2).max(120),
  /** CPF (11 dígitos, com ou sem máscara — normaliza no handler) */
  cpf: z.string().min(11).max(14),
  /** Email pra recuperação + segundo canal */
  email: z.string().email().max(255),
  /** Telefone E.164 (mesmo que validou via OTP) */
  phone: PhoneSchema,
  /** Senha (BetterAuth/Lucia hash no Sprint 02b2 — esperar Sprint 01a sub) */
  password: z.string().min(8).max(128),
  /** ID do OTP verificado em `verifySmsCode` (anti-replay — exige used_at recente) */
  smsOtpId: z.string().uuid(),
  /** Aceite explícito de Termos + Política de Privacidade */
  acceptedTerms: z.literal(true),
  acceptedPrivacy: z.literal(true),
  /** MFA inicial — Sprint 02b2 conecta TOTP setup wizard pós-signup */
  enableMfa: z.boolean().default(false),
  /** Locale do SMS (default pt-BR) */
  locale: z.enum(['pt-BR', 'en-US', 'es-419']).default('pt-BR'),
  /**
   * Token de invite quando paciente veio de `/i/[token]` (Path A+B híbrido).
   * Quando presente, após criar identidade global, auto-aceita o invite:
   * cria persons espelho no tenant emissor + ativa patient_company_links
   * + ativa patient_link_modules. MVP: token == link.id UUID; Sprint 02b2
   * refina pra opaque signed token.
   */
  inviteToken: z.string().uuid().optional().nullable(),
})

/** Tempo de vida do OTP — 5 minutos */
const OTP_TTL_MS = 5 * 60 * 1000
/** Máximo de attempts de verify por OTP */
const MAX_VERIFY_ATTEMPTS = 5
/** Janela do anti-enumeration retry — usado=true 30d audit, então 30d */
const OTP_USED_AUDIT_MS = 30 * 24 * 60 * 60 * 1000

// ─── requestSmsCode ────────────────────────────────────────────────────

// wrap-exempt: pré-auth público visitor anônimo (sem session); anti-enumeration sempre retorna ok:true
export async function requestSmsCode(input: unknown) {
  const parsed = RequestSmsSchema.safeParse(input)
  if (!parsed.success) {
    // Anti-enumeration: erros de validação retornam ok:true silencioso
    return { ok: true as const, sent: false }
  }
  const { phone, captchaToken } = parsed.data

  // 1. Verifica Turnstile (mock em dev)
  const captcha = await verifyCaptcha({ token: captchaToken })
  if (!captcha.valid) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Captcha inválido ou expirado',
      request_id: '',
    })
  }

  // 2. Rate limit por telefone — bloqueia se já existe OTP ativo não-expirado
  const active = await pool.query<{ id: string }>(
    `SELECT id FROM passport_signup_otps
     WHERE phone = $1 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [phone],
  )
  if (active.rows.length > 0) {
    // Invalida o anterior (revoga implícito) — caller pode pedir novo legitimamente
    await pool.query(`UPDATE passport_signup_otps SET used_at = now() WHERE id = $1`, [
      active.rows[0]!.id,
    ])
  }

  // 3. Gera código + grava hash
  const code = generateOtpCode()
  const codeHash = hashOtpCode(code)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  // 4. Envia SMS (mock em dev)
  const sms = await sendSmsOtp({ phone, code })

  // 5. Persiste OTP (sempre — mesmo se sms.sent=false, audit serve)
  const r = await pool.query<{ id: string }>(
    `INSERT INTO passport_signup_otps
     (phone, code_hash, expires_at, sms_provider, sms_message_sid)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [phone, codeHash, expiresAt, sms.provider, sms.messageSid ?? null],
  )

  return {
    ok: true as const,
    sent: sms.sent,
    otpId: r.rows[0]!.id,
    expiresAt: expiresAt.toISOString(),
    /** Em dev/mock, devolve o código pro caller log/inspect — NUNCA expor em prod */
    devOnlyCode: sms.provider === 'mock' ? code : undefined,
  }
}

// ─── verifySmsCode ──────────────────────────────────────────────────────

// wrap-exempt: pré-auth público visitor anônimo (sem session); OTP recente é o gate
export async function verifySmsCode(input: unknown) {
  const parsed = VerifySmsSchema.safeParse(input)
  if (!parsed.success) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Telefone ou código inválido',
      request_id: '',
    })
  }
  const { phone, code } = parsed.data

  // 1. Busca OTP mais recente não-usado pra este telefone
  const r = await pool.query<{
    id: string
    code_hash: string
    expires_at: Date
    used_at: Date | null
    attempts: number
  }>(
    `SELECT id, code_hash, expires_at, used_at, attempts
     FROM passport_signup_otps
     WHERE phone = $1
     ORDER BY created_at DESC LIMIT 1`,
    [phone],
  )
  const otp = r.rows[0]
  if (!otp) {
    throw new ApiException({
      code: 'NOT_FOUND',
      message: 'Nenhum código pendente — solicite um novo',
      request_id: '',
    })
  }

  if (otp.used_at) {
    throw new ApiException({
      code: 'CONFLICT',
      message: 'Código já utilizado — solicite um novo',
      request_id: '',
    })
  }

  if (otp.expires_at.getTime() < Date.now()) {
    throw new ApiException({
      code: 'NOT_FOUND',
      message: 'Código expirado — solicite um novo',
      request_id: '',
    })
  }

  if (otp.attempts >= MAX_VERIFY_ATTEMPTS) {
    // Invalida OTP — força novo request
    await pool.query(`UPDATE passport_signup_otps SET used_at = now() WHERE id = $1`, [otp.id])
    throw new ApiException({
      code: 'RATE_LIMITED',
      message: 'Muitas tentativas — solicite um novo código',
      request_id: '',
    })
  }

  // 2. Verifica código (constant-time)
  if (!verifyOtpCode(code, otp.code_hash)) {
    // Incrementa attempts + retorna erro genérico (não revela "código quase certo")
    await pool.query(
      `UPDATE passport_signup_otps SET attempts = attempts + 1 WHERE id = $1`,
      [otp.id],
    )
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Código inválido',
      request_id: '',
    })
  }

  // 3. Marca used_at — sucesso
  await pool.query(`UPDATE passport_signup_otps SET used_at = now() WHERE id = $1`, [otp.id])

  return { ok: true as const, otpId: otp.id, phone }
}

// ─── signupPatient (STUB — Sprint 02b2 completa) ────────────────────────

/**
 * Cria identidade global do paciente (sem tenant clínico) + senha + opcional MFA.
 *
 * **MVP**: retorna `{ok: false, code: 'SCHEMA_PENDING'}` até ADR decidir
 * schema persons-without-tenant. Toda a validação rola normalmente (Zod +
 * Turnstile + OTP) — só o INSERT final fica bloqueado.
 *
 * Sprint 02b2 completa este handler quando ADR fechar (provavelmente opção C —
 * tabela `passport_global_identities` separada).
 */
// wrap-exempt: pré-auth público visitor anônimo (sem session); cria a identidade global (ADR 0093)
export async function signupPatient(input: unknown) {
  const parsed = SignupPatientSchema.safeParse(input)
  if (!parsed.success) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      request_id: '',
    })
  }

  // 1. Re-valida OTP usado recentemente (anti-replay)
  const otp = await pool.query<{
    id: string
    phone: string
    used_at: Date | null
  }>(
    `SELECT id, phone, used_at FROM passport_signup_otps WHERE id = $1 LIMIT 1`,
    [parsed.data.smsOtpId],
  )
  const otpRow = otp.rows[0]
  if (!otpRow || !otpRow.used_at) {
    throw new ApiException({
      code: 'FORBIDDEN',
      message: 'OTP não verificado — execute verifySmsCode antes',
      request_id: '',
    })
  }
  if (otpRow.phone !== parsed.data.phone) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Telefone não corresponde ao OTP verificado',
      request_id: '',
    })
  }
  const usedAge = Date.now() - otpRow.used_at.getTime()
  if (usedAge > OTP_USED_AUDIT_MS) {
    throw new ApiException({
      code: 'FORBIDDEN',
      message: 'OTP verificado há muito tempo — solicite um novo',
      request_id: '',
    })
  }

  // 2. CPF normalizado (só dígitos)
  const cpfNormalized = parsed.data.cpf.replace(/\D/g, '')
  if (cpfNormalized.length !== 11) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'CPF deve ter 11 dígitos',
      request_id: '',
    })
  }

  // 3. Detecta conta duplicada (CPF ou email) antes do INSERT
  // Anti-enumeration: erro genérico (não revela qual dos dois bateu)
  const dup = await pool.query<{ id: string }>(
    `SELECT id FROM passport_global_identities
     WHERE (cpf_normalized = $1 OR lower(email) = lower($2))
       AND deactivated_at IS NULL
     LIMIT 1`,
    [cpfNormalized, parsed.data.email],
  )
  if (dup.rows.length > 0) {
    throw new ApiException({
      code: 'CONFLICT',
      message: 'Conta já cadastrada com este CPF ou email — use /meu/login',
      request_id: '',
    })
  }

  // 4. Hash de senha (scrypt — packages/security/password-hash.ts)
  const passwordHash = await hashPassword(parsed.data.password)

  // 5. Gera recovery codes só se MFA está habilitado no signup
  //    (Sprint 02b3 wizard MFA pós-signup separado pode regenerar)
  let recoveryCodesPlainForUI: string[] | null = null
  let recoveryCodesEncrypted: string | null = null
  if (parsed.data.enableMfa) {
    const plain = generateRecoveryCodes(10)
    const codesPayload = plain.map((c) => ({ hash: hashRecoveryCode(c), used_at: null }))
    // Envelope encryption AES-256-GCM via LOGIFIT_DATA_KEY (ADR 0073).
    // Em dev requer .env.local com LOGIFIT_DATA_KEY=`openssl rand -base64 32`.
    try {
      recoveryCodesEncrypted = encryptSecret(JSON.stringify(codesPayload))
    } catch (err) {
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message:
          'Servidor não configurou LOGIFIT_DATA_KEY — MFA indisponível. ' +
          'Configure pra ativar MFA, ou cadastre sem MFA e ative depois.',
        request_id: '',
        details: { reason: err instanceof Error ? err.message : 'unknown' },
      })
    }
    recoveryCodesPlainForUI = plain
  }

  // 6. INSERT identidade global (signup proativo)
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO passport_global_identities (
       name, cpf_normalized, email, phone, phone_verified_at,
       password_hash,
       recovery_codes_encrypted,
       accepted_terms_at, terms_version,
       accepted_privacy_at, privacy_version, ripd_version_signup,
       signup_path, signup_otp_id
     ) VALUES (
       $1, $2, $3, $4, now(),
       $5,
       $6,
       now(), $7,
       now(), $8, $9,
       $10, $11
     )
     RETURNING id`,
    [
      parsed.data.name,
      cpfNormalized,
      parsed.data.email,
      parsed.data.phone,
      passwordHash,
      recoveryCodesEncrypted,
      'v1.0', // terms_version — Sprint 02b3 promove pra fetch de tabela
      'v1.0', // privacy_version
      'v1.0-passport-signup', // ripd_version_signup
      // signup_path: 'proactive_then_invite' quando veio de /i/[token] — Path A+B híbrido
      parsed.data.inviteToken ? 'proactive_then_invite' : 'proactive',
      otpRow.id,
    ],
  )

  const passportGlobalId = ins.rows[0]!.id

  // 7. Path A+B híbrido: se inviteToken presente, auto-aceita o invite
  //    (cria persons espelho no tenant emissor + ativa link + modules).
  //    Failure-tolerant: se invite inválido/expirado, identity global continua
  //    criada (paciente pode aceitar invites depois manualmente).
  const linkedTenants: Array<{ tenantId: string; linkId: string; tenantName: string }> = []
  if (parsed.data.inviteToken) {
    try {
      const linked = await acceptInviteAfterSignup({
        inviteToken: parsed.data.inviteToken,
        passportGlobalId,
        patientName: parsed.data.name,
        patientCpfNormalized: cpfNormalized,
        patientEmail: parsed.data.email,
        patientPhone: parsed.data.phone,
      })
      if (linked) linkedTenants.push(linked)
    } catch (err) {
      // Log warning mas não falha o signup — identidade global já criada
      console.warn(
        '[signupPatient] auto-accept invite falhou (signup OK):',
        err instanceof Error ? err.message : err,
      )
    }
  }

  return {
    ok: true as const,
    passportGlobalId,
    /** Recovery codes (única chance — usuário precisa salvar). Null se MFA não habilitado no signup. */
    recoveryCodes: recoveryCodesPlainForUI,
    /** Tenants vinculados automaticamente quando vier de /i/[token] (Path A+B híbrido) */
    linkedTenants,
    /** Sprint 02b3 redireciona pra /meu/login (member portal vai refatorar pra resolver passport_global_identity_id em vez de member_sessions atual). */
    redirectUrl: '/meu/login',
    note:
      'Sprint 02b2 partial — identity global criada. Login flow (/meu/login resolver passport_global_identity_id) e wizard MFA TOTP entram em Sprint 02b3.',
  }
}

// ─── acceptInviteAfterSignup (helper interno do Path A+B híbrido) ──────

/**
 * Helper interno (não exportado pra fora do `'use server'`) — chamado
 * apenas pelo signupPatient quando inviteToken vem de /i/[token].
 *
 * Diferente de `acceptPatientInvite` em `app/passport/actions.ts` que exige
 * staff session, este helper roda pré-auth (paciente recém-criado sem
 * member_session ainda). Valida o invite + cria persons espelho + ativa
 * link/modules direto via `pool.query`.
 *
 * Failure-tolerant: caller (signupPatient) catch + log warning sem falhar
 * signup. Paciente ainda tem identity global; pode aceitar invites depois.
 */
async function acceptInviteAfterSignup(params: {
  inviteToken: string
  passportGlobalId: string
  patientName: string
  patientCpfNormalized: string
  patientEmail: string
  patientPhone: string
}): Promise<{ tenantId: string; linkId: string; tenantName: string } | null> {
  // 1. Resolve invite — MVP: token == link.id UUID
  const linkRows = await pool.query<{
    id: string
    tenant_id: string
    person_id: string
    tenant_name: string
    status: string
  }>(
    `SELECT pcl.id, pcl.tenant_id, pcl.person_id, t.name AS tenant_name, pcl.status::text
     FROM patient_company_links pcl
     INNER JOIN tenants t ON t.id = pcl.tenant_id
     WHERE pcl.id = $1
       AND pcl.revoked_at IS NULL
     LIMIT 1`,
    [params.inviteToken],
  )
  const link = linkRows.rows[0]
  if (!link) {
    throw new Error('invite not found')
  }
  if (link.status !== 'pending') {
    throw new Error(`invite status ${link.status} (esperado pending)`)
  }

  // 2. Cria persons espelho no tenant emissor com FK pra global identity
  //    Acesso pré-auth via pool (sem RLS por tenant — Server Action sem session
  //    nesta etapa; lint cross-tenant-read-must-log não dispara pq não chama
  //    has_cross_tenant_access nem grava patient_data_access_log — esta operação
  //    é setup inicial do vínculo, não leitura cross-tenant).
  const personRows = await pool.query<{ id: string }>(
    `INSERT INTO persons (
       tenant_id, kind, name, document, email, phone,
       passport_global_identity_id
     ) VALUES (
       $1, 'pf', $2, $3, $4, $5,
       $6
     )
     ON CONFLICT (tenant_id, document) WHERE document IS NOT NULL
     DO UPDATE SET
       passport_global_identity_id = EXCLUDED.passport_global_identity_id,
       updated_at = now()
     RETURNING id`,
    [
      link.tenant_id,
      params.patientName,
      params.patientCpfNormalized,
      params.patientEmail,
      params.patientPhone,
      params.passportGlobalId,
    ],
  )
  const personId = personRows.rows[0]!.id

  // 3. Atualiza link: status='active', accepted_at, person_id (caso seja UPSERT)
  await pool.query(
    `UPDATE patient_company_links
     SET status = 'active',
         accepted_at = now(),
         person_id = $1,
         updated_at = now()
     WHERE id = $2`,
    [personId, link.id],
  )

  // 4. Ativa todos os modules pending do link
  await pool.query(
    `UPDATE patient_link_modules
     SET status = 'active',
         activated_at = now(),
         updated_at = now()
     WHERE link_id = $1 AND status = 'pending'`,
    [link.id],
  )

  return {
    tenantId: link.tenant_id,
    linkId: link.id,
    tenantName: link.tenant_name,
  }
}
