'use server'

/**
 * Server Actions Passaporte Cross-Tenant — Sprint 02 fechamento (regra 42 + ADR 0077).
 *
 * **Caller é staff** (profissional do tenant emissor). Member portal usa
 * actions próprias em `/meu/privacidade/actions.ts` (Sprint 26).
 *
 * Schema vive em `passport.ts`:
 *   - `patient_company_links` (status=pending|active|revoked + creation_path)
 *   - `patient_link_modules` (constraint global 1 módulo ativo por paciente)
 *   - `patient_data_access_log` (auditoria leituras cross-tenant)
 *
 * **Fluxo invite reativo** (path A — Sprint 02):
 *   1. Staff chama `sendPatientInvite(...)` → cria link status='pending' +
 *      modules status='pending'.
 *   2. Paciente abre landing `/i/[link_id]` (resolve via `GET /api/i/[link_id]`).
 *   3. Paciente faz login/cadastro + chama `acceptPatientInvite(linkId, modules[])` →
 *      atualiza para 'active' + dispara constraint global de substituição se
 *      houver módulo ativo do mesmo tipo.
 *
 * **Path B proativo** (cadastro autônomo `/cadastro`) adiado pra Sprint 02b
 * — depende Twilio SMS + Turnstile real + decisão schema persons-without-tenant.
 *
 * Reads cross-tenant chamam `has_cross_tenant_access()` SQL antes de retornar
 * dado + persistem audit em `patient_data_access_log` (lint
 * `cross-tenant-read-must-log` enforça).
 */

import { randomUUID } from 'node:crypto'
import { db, pool } from '@repo/db/client'
import {
  patientCompanyLinks,
  patientDataAccessLog,
  patientLinkModules,
  persons,
} from '@repo/db/schema'
import { sendTransactional } from '@repo/email'
import { ApiException } from '@repo/errors'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  renderPassportInviteHtml,
  renderPassportInviteText,
} from '../../lib/email-templates/passport-invite'
import { logPatientLinkEvent } from '../../lib/passport-event-log'
import { buildInviteUrl, buildPatientWhatsappShareUrl } from '../../lib/passport-invite-share'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod schemas ────────────────────────────────────────────────────────

const DataLevelsSchema = z
  .object({
    identidade: z.boolean().default(false),
    antropometria: z.boolean().default(false),
    treino: z.boolean().default(false),
    clinico: z.boolean().default(false),
  })
  .strict()

const ModuleEnum = z.enum(['academia', 'personal_training', 'fisioterapia', 'nutricao', 'pilates'])
type ModuleKind = z.infer<typeof ModuleEnum>

const ModuleInputSchema = z.object({
  module: ModuleEnum,
  responsibleProfessionalUserId: z.string().uuid(),
  dataLevels: DataLevelsSchema,
})

const SendInviteSchema = z.object({
  /** UUID global do passaporte. Frontend resolve via hash(cpf) ou pega de paciente existente. */
  passportPassportId: z.string().uuid(),
  /** person_id local do tenant emissor (paciente já cadastrado no tenant) */
  personId: z.string().uuid(),
  modules: z.array(ModuleInputSchema).min(1).max(5),
})

const AcceptInviteSchema = z.object({
  linkId: z.string().uuid(),
  /** Subset dos módulos do invite que o paciente aceita. Vazio = aceita todos. */
  acceptedModules: z.array(ModuleEnum).optional(),
  /** Override de dataLevels por módulo aceito (granularidade). */
  dataLevelOverrides: z.record(ModuleEnum, DataLevelsSchema).optional(),
})

const CancelInviteSchema = z.object({
  linkId: z.string().uuid(),
})

const RevokeLinkSchema = z.object({
  linkId: z.string().uuid(),
  reason: z.string().min(2).max(500),
})

const ConfirmSubstitutionSchema = z.object({
  newLinkId: z.string().uuid(),
  module: ModuleEnum,
})

const SetSharingLevelSchema = z.object({
  linkModuleId: z.string().uuid(),
  dataLevels: DataLevelsSchema,
})

const ListInvitesSchema = z
  .object({
    status: z.enum(['pending', 'active', 'revoked', 'all']).default('all'),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .optional()

const CrossTenantReadSchema = z.object({
  passportPassportId: z.string().uuid(),
  module: ModuleEnum,
  /** Categoria de dados a ler (identidade/antropometria/treino/clinico). Limites duros (financeiro/prontuario_cfm_bruto/terceiros_mencionados/workspace) sempre bloqueiam. */
  category: z.enum([
    'identidade',
    'antropometria',
    'treino',
    'clinico',
    'financeiro',
    'prontuario_cfm_bruto',
    'terceiros_mencionados',
    'workspace',
  ]),
  /** Recurso específico que será lido (audit log) */
  resourceType: z.string().min(2).max(80),
  resourceId: z.string().uuid().optional().nullable(),
})

// ─── sendPatientInvite ──────────────────────────────────────────────────

export const sendPatientInvite = wrapServerAction(
  {
    module: 'passport',
    action: 'invite.send',
    resourceType: 'patient_company_links',
  },
  async (input: z.infer<typeof SendInviteSchema>, { session, setAuditResource }) => {
    const parsed = SendInviteSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida person do tenant
    const personRow = await db
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.id, parsed.personId), eq(persons.tenantId, tenantId)))
      .limit(1)
    if (personRow.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Person não encontrada no tenant',
        request_id: '',
      })
    }

    // Verifica se já não existe link ativo/pending pra este passport+tenant
    const existing = await db
      .select({ id: patientCompanyLinks.id, status: patientCompanyLinks.status })
      .from(patientCompanyLinks)
      .where(
        and(
          eq(patientCompanyLinks.passportPassportId, parsed.passportPassportId),
          eq(patientCompanyLinks.tenantId, tenantId),
          sql`${patientCompanyLinks.revokedAt} IS NULL`,
        ),
      )
      .limit(1)
    if (existing.length > 0) {
      throw new ApiException({
        code: 'CONFLICT',
        message: `Já existe vínculo ${existing[0]!.status} pra este paciente neste tenant`,
        request_id: '',
      })
    }

    // Cria link + modules em transação
    const linkId = await db.transaction(async (tx) => {
      const [linkRow] = await tx
        .insert(patientCompanyLinks)
        .values({
          passportPassportId: parsed.passportPassportId,
          personId: parsed.personId,
          tenantId,
          status: 'pending',
          creationPath: 'reactive',
          invitedByUserId: session.user.id,
          invitedAt: new Date(),
        })
        .returning({ id: patientCompanyLinks.id })

      for (const m of parsed.modules) {
        await tx.insert(patientLinkModules).values({
          linkId: linkRow!.id,
          passportPassportId: parsed.passportPassportId,
          module: m.module,
          status: 'pending',
          responsibleProfessionalUserId: m.responsibleProfessionalUserId,
          dataLevels: m.dataLevels,
        })
      }

      return linkRow!.id
    })

    // Emite eventos de lifecycle (Sprint 02c.4) — best-effort, fora da tx
    await logPatientLinkEvent({
      tenantId,
      linkId,
      passportPassportId: parsed.passportPassportId,
      patientPersonId: parsed.personId,
      actorKind: 'professional',
      actorUserId: session.user.id,
      eventKind: 'invite_sent',
      payload: { creationPath: 'reactive', moduleCount: parsed.modules.length },
    })
    for (const m of parsed.modules) {
      await logPatientLinkEvent({
        tenantId,
        linkId,
        passportPassportId: parsed.passportPassportId,
        patientPersonId: parsed.personId,
        actorKind: 'professional',
        actorUserId: session.user.id,
        eventKind: 'module_added',
        payload: {
          module: m.module,
          responsibleProfessionalUserId: m.responsibleProfessionalUserId,
          dataLevels: m.dataLevels,
        },
      })
    }

    setAuditResource(linkId, {
      passport_id: parsed.passportPassportId,
      modules: parsed.modules.map((m) => m.module),
    })

    // Sprint 02b8: resolve canais de envio (3 vias — email auto, WhatsApp
    // staff-shared, copy link manual). Caller UI decide quais botões mostrar.
    const inviteUrl = buildInviteUrl(linkId)
    const moduleKeys = parsed.modules.map((m) => m.module)

    // Resolve person (email + phone) + tenant.name + nome do profissional
    // emissor em 1 query JOIN.
    // invited_by_name aumenta conversão ~12% (B2B health Customer.io 2025) —
    // "Dra. Maria Silva da Clínica Vital te convidou" vs "Clínica Vital te
    // convidou". LEFT JOIN pra não quebrar se user emissor não existir.
    const ctx = await pool.query<{
      person_email: string | null
      person_name: string
      person_phone: string | null
      tenant_name: string
      invited_by_name: string | null
    }>(
      `SELECT p.email AS person_email, p.name AS person_name, p.phone AS person_phone,
              t.name AS tenant_name,
              u.name AS invited_by_name
         FROM persons p
         INNER JOIN tenants t ON t.id = p.tenant_id
         LEFT JOIN users u ON u.id = $3
         WHERE p.id = $1 AND p.tenant_id = $2
         LIMIT 1`,
      [parsed.personId, tenantId, session.user.id],
    )
    const personCtx = ctx.rows[0]

    // Email automático (só se person.email existe e SMTP configurado)
    let emailSent: boolean | null = null
    if (personCtx?.person_email) {
      try {
        const r = await sendTransactional({
          to: personCtx.person_email,
          toName: personCtx.person_name,
          subject: `Convite — ${personCtx.tenant_name} quer vincular sua conta LogiFit`,
          htmlBody: renderPassportInviteHtml({
            patientName: personCtx.person_name,
            tenantName: personCtx.tenant_name,
            invitedByName: personCtx.invited_by_name,
            modules: moduleKeys,
            inviteUrl,
            tenantWhatsapp: process.env.NEXT_PUBLIC_LOGIFIT_WHATSAPP_NUMBER ?? null,
          }),
          textBody: renderPassportInviteText({
            patientName: personCtx.person_name,
            tenantName: personCtx.tenant_name,
            invitedByName: personCtx.invited_by_name,
            modules: moduleKeys,
            inviteUrl,
            tenantWhatsapp: process.env.NEXT_PUBLIC_LOGIFIT_WHATSAPP_NUMBER ?? null,
          }),
          category: 'tenant',
          tenantId,
        })
        emailSent = r.ok
        if (!r.ok) {
          console.error(
            JSON.stringify({
              level: 'error',
              event: 'passport_invite_email_send_failed',
              provider: r.provider,
              errorCode: r.errorCode,
              linkIdPrefix: linkId.slice(0, 8),
            }),
          )
        }
      } catch (err) {
        emailSent = false
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'passport_invite_email_dispatch_failed',
            linkIdPrefix: linkId.slice(0, 8),
            error: err instanceof Error ? err.message : 'unknown',
          }),
        )
      }
    }

    // WhatsApp share URL pro staff (mensagem pré-formatada em nome da clínica
    // direcionada AO número do paciente). Se phone vazio, fica null e UI
    // mostra só o botão "Copy link".
    const whatsappShareUrl = personCtx?.person_phone
      ? buildPatientWhatsappShareUrl({
          patientPhone: personCtx.person_phone,
          patientName: personCtx.person_name,
          tenantName: personCtx.tenant_name,
          modules: moduleKeys,
          inviteUrl,
        })
      : null

    return {
      ok: true as const,
      linkId,
      inviteUrl,
      emailSent,
      whatsappShareUrl,
    }
  },
)

// ─── acceptPatientInvite ───────────────────────────────────────────────
// Paciente clica em /i/[linkId], faz login/cadastro e aceita.
// MVP: caller é session do staff em nome do paciente; Sprint 02b roda no
// member portal session.

export const acceptPatientInvite = wrapServerAction(
  {
    module: 'passport',
    action: 'invite.accept',
    resourceType: 'patient_company_links',
  },
  async (input: z.infer<typeof AcceptInviteSchema>, { session, setAuditResource }) => {
    const parsed = AcceptInviteSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Carrega link + modules pendentes
    const [link] = await db
      .select()
      .from(patientCompanyLinks)
      .where(
        and(
          eq(patientCompanyLinks.id, parsed.linkId),
          eq(patientCompanyLinks.tenantId, tenantId),
          eq(patientCompanyLinks.status, 'pending'),
        ),
      )
      .limit(1)
    if (!link) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Invite não encontrado ou já aceito',
        request_id: '',
      })
    }

    const linkModules = await db
      .select()
      .from(patientLinkModules)
      .where(eq(patientLinkModules.linkId, link.id))

    const acceptedSet = new Set<ModuleKind>(
      parsed.acceptedModules && parsed.acceptedModules.length > 0
        ? parsed.acceptedModules
        : linkModules.map((m) => m.module as ModuleKind),
    )

    // Detecta colisões com módulos ativos em outros tenants (constraint global)
    const collisions: Array<{ module: string; conflictingLinkModuleId: string }> = []
    for (const m of linkModules) {
      if (!acceptedSet.has(m.module as ModuleKind)) continue
      const [conflict] = await db
        .select({ id: patientLinkModules.id })
        .from(patientLinkModules)
        .where(
          and(
            eq(patientLinkModules.passportPassportId, link.passportPassportId),
            eq(patientLinkModules.module, m.module as ModuleKind),
            eq(patientLinkModules.status, 'active'),
            sql`${patientLinkModules.deactivatedAt} IS NULL`,
          ),
        )
        .limit(1)
      if (conflict && conflict.id !== m.id) {
        collisions.push({ module: m.module, conflictingLinkModuleId: conflict.id })
      }
    }

    if (collisions.length > 0) {
      throw new ApiException({
        code: 'CONFLICT',
        message: `Substituição requerida em ${collisions.length} módulo(s) ativos: ${collisions
          .map((c) => c.module)
          .join(', ')}. Chame confirmModuleSubstitution() para cada.`,
        request_id: '',
      })
    }

    await db.transaction(async (tx) => {
      await tx
        .update(patientCompanyLinks)
        .set({ status: 'active', acceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(patientCompanyLinks.id, link.id))

      for (const m of linkModules) {
        if (!acceptedSet.has(m.module as ModuleKind)) continue
        const overrides = parsed.dataLevelOverrides?.[m.module as ModuleKind]
        await tx
          .update(patientLinkModules)
          .set({
            status: 'active',
            activatedAt: new Date(),
            dataLevels: overrides ?? m.dataLevels,
            updatedAt: new Date(),
          })
          .where(eq(patientLinkModules.id, m.id))
      }
    })

    // Emite eventos lifecycle (Sprint 02c.4)
    await logPatientLinkEvent({
      tenantId,
      linkId: link.id,
      passportPassportId: link.passportPassportId,
      patientPersonId: link.personId,
      actorKind: 'professional', // MVP: staff em nome do paciente; Sprint 02b8+ roda no portal member
      actorUserId: session.user.id,
      eventKind: 'link_accepted',
      payload: { acceptedCount: Array.from(acceptedSet).length },
    })
    for (const m of linkModules) {
      if (!acceptedSet.has(m.module as ModuleKind)) continue
      await logPatientLinkEvent({
        tenantId,
        linkId: link.id,
        passportPassportId: link.passportPassportId,
        patientPersonId: link.personId,
        actorKind: 'professional',
        actorUserId: session.user.id,
        eventKind: 'module_activated',
        payload: { module: m.module },
      })
    }

    setAuditResource(link.id, {
      passport_id: link.passportPassportId,
      accepted_modules: Array.from(acceptedSet),
    })

    return {
      ok: true as const,
      linkId: link.id,
      acceptedCount: linkModules.filter((m) => acceptedSet.has(m.module as ModuleKind)).length,
    }
  },
)

// ─── cancelPatientInvite ───────────────────────────────────────────────
// Staff cancela invite ainda não aceito.

export const cancelPatientInvite = wrapServerAction(
  {
    module: 'passport',
    action: 'invite.cancel',
    resourceType: 'patient_company_links',
  },
  async (input: z.infer<typeof CancelInviteSchema>, { session, setAuditResource }) => {
    const parsed = CancelInviteSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(patientCompanyLinks)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        revokedReason: 'cancelled_by_staff',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(patientCompanyLinks.id, parsed.linkId),
          eq(patientCompanyLinks.tenantId, tenantId),
          eq(patientCompanyLinks.status, 'pending'),
        ),
      )
      .returning({
        id: patientCompanyLinks.id,
        passportPassportId: patientCompanyLinks.passportPassportId,
        personId: patientCompanyLinks.personId,
      })

    if (!row) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Invite não encontrado ou já em status terminal',
        request_id: '',
      })
    }

    // Emite evento lifecycle (Sprint 02c.4)
    await logPatientLinkEvent({
      tenantId,
      linkId: row.id,
      passportPassportId: row.passportPassportId,
      patientPersonId: row.personId,
      actorKind: 'professional',
      actorUserId: session.user.id,
      eventKind: 'invite_cancelled',
      payload: { reason: 'cancelled_by_staff' },
    })

    setAuditResource(row.id, { reason: 'cancelled_by_staff' })
    return { ok: true as const }
  },
)

// ─── revokePatientLink ────────────────────────────────────────────────
// Staff revoga vínculo ativo (paciente revoga via /meu/privacidade/actions.ts).

export const revokePatientLink = wrapServerAction(
  {
    module: 'passport',
    action: 'link.revoke',
    resourceType: 'patient_company_links',
  },
  async (input: z.infer<typeof RevokeLinkSchema>, { session, setAuditResource }) => {
    const parsed = RevokeLinkSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(patientCompanyLinks)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        revokedReason: parsed.reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(patientCompanyLinks.id, parsed.linkId),
          eq(patientCompanyLinks.tenantId, tenantId),
          eq(patientCompanyLinks.status, 'active'),
        ),
      )
      .returning({
        id: patientCompanyLinks.id,
        passportId: patientCompanyLinks.passportPassportId,
        personId: patientCompanyLinks.personId,
      })

    if (!row) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Vínculo não encontrado ou já revogado',
        request_id: '',
      })
    }

    // Desativa todos os módulos do link em cascata + captura quais foram pra emitir 1 evento por module
    const deactivatedModules = await db
      .update(patientLinkModules)
      .set({
        status: 'inactive',
        deactivatedAt: new Date(),
        deactivatedReason: 'link_revoked',
        updatedAt: new Date(),
      })
      .where(eq(patientLinkModules.linkId, parsed.linkId))
      .returning({ module: patientLinkModules.module })

    // Emite eventos lifecycle (Sprint 02c.4)
    await logPatientLinkEvent({
      tenantId,
      linkId: row.id,
      passportPassportId: row.passportId,
      patientPersonId: row.personId,
      actorKind: 'professional',
      actorUserId: session.user.id,
      eventKind: 'link_revoked',
      payload: { reason: parsed.reason, deactivatedModuleCount: deactivatedModules.length },
    })
    for (const m of deactivatedModules) {
      await logPatientLinkEvent({
        tenantId,
        linkId: row.id,
        passportPassportId: row.passportId,
        patientPersonId: row.personId,
        actorKind: 'professional',
        actorUserId: session.user.id,
        eventKind: 'module_deactivated',
        payload: { module: m.module, reason: 'link_revoked' },
      })
    }

    setAuditResource(row.id, { reason: parsed.reason })
    return { ok: true as const }
  },
)

// ─── confirmModuleSubstitution ────────────────────────────────────────
// Paciente confirma que vai trocar de empresa em módulo já ativo em outro tenant.
// Desativa módulo antigo + ativa novo em transação.

export const confirmModuleSubstitution = wrapServerAction(
  {
    module: 'passport',
    action: 'module.substitute',
    resourceType: 'patient_link_modules',
  },
  async (input: z.infer<typeof ConfirmSubstitutionSchema>, { session, setAuditResource }) => {
    const parsed = ConfirmSubstitutionSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Resolve novo link + module (escopo tenant)
    const [newLink] = await db
      .select()
      .from(patientCompanyLinks)
      .where(
        and(
          eq(patientCompanyLinks.id, parsed.newLinkId),
          eq(patientCompanyLinks.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!newLink) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Novo link não encontrado neste tenant',
        request_id: '',
      })
    }

    const [newModule] = await db
      .select()
      .from(patientLinkModules)
      .where(
        and(
          eq(patientLinkModules.linkId, newLink.id),
          eq(patientLinkModules.module, parsed.module),
          eq(patientLinkModules.status, 'pending'),
        ),
      )
      .limit(1)
    if (!newModule) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Novo módulo não encontrado em estado pending',
        request_id: '',
      })
    }

    await db.transaction(async (tx) => {
      // Desativa módulo ativo global (em qualquer tenant)
      await tx
        .update(patientLinkModules)
        .set({
          status: 'inactive',
          deactivatedAt: new Date(),
          deactivatedReason: 'substituted_by_other_tenant',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(patientLinkModules.passportPassportId, newLink.passportPassportId),
            eq(patientLinkModules.module, parsed.module),
            eq(patientLinkModules.status, 'active'),
            sql`${patientLinkModules.deactivatedAt} IS NULL`,
          ),
        )

      // Ativa novo módulo
      await tx
        .update(patientLinkModules)
        .set({
          status: 'active',
          activatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(patientLinkModules.id, newModule.id))

      // Se o newLink ainda está pending (primeira ativação) eleva pra active
      if (newLink.status === 'pending') {
        await tx
          .update(patientCompanyLinks)
          .set({ status: 'active', acceptedAt: new Date(), updatedAt: new Date() })
          .where(eq(patientCompanyLinks.id, newLink.id))
      }
    })

    // Emite eventos lifecycle no tenant atual (Sprint 02c.4) — substituição
    // remota não loga no outro tenant (RLS bloqueia cross-tenant INSERT)
    await logPatientLinkEvent({
      tenantId,
      linkId: newLink.id,
      passportPassportId: newLink.passportPassportId,
      patientPersonId: newLink.personId,
      actorKind: 'professional',
      actorUserId: session.user.id,
      eventKind: 'module_substituted',
      payload: { module: parsed.module },
    })
    await logPatientLinkEvent({
      tenantId,
      linkId: newLink.id,
      passportPassportId: newLink.passportPassportId,
      patientPersonId: newLink.personId,
      actorKind: 'professional',
      actorUserId: session.user.id,
      eventKind: 'module_activated',
      payload: { module: parsed.module, viaSubstitution: true },
    })

    setAuditResource(newModule.id, {
      passport_id: newLink.passportPassportId,
      substituted_module: parsed.module,
    })

    return { ok: true as const }
  },
)

// ─── setSharingLevel ──────────────────────────────────────────────────
// Staff ajusta níveis de dados de um módulo (com consent prévio do paciente
// regra 42; Sprint 02b adiciona consent flow real).

export const setSharingLevel = wrapServerAction(
  {
    module: 'passport',
    action: 'module.set_sharing',
    resourceType: 'patient_link_modules',
  },
  async (input: z.infer<typeof SetSharingLevelSchema>, { session, setAuditResource }) => {
    const parsed = SetSharingLevelSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida módulo do tenant via JOIN
    const [row] = await db
      .select({
        id: patientLinkModules.id,
        linkId: patientLinkModules.linkId,
        passportId: patientLinkModules.passportPassportId,
        module: patientLinkModules.module,
        dataLevelsBefore: patientLinkModules.dataLevels,
        personId: patientCompanyLinks.personId,
      })
      .from(patientLinkModules)
      .innerJoin(patientCompanyLinks, eq(patientCompanyLinks.id, patientLinkModules.linkId))
      .where(
        and(
          eq(patientLinkModules.id, parsed.linkModuleId),
          eq(patientCompanyLinks.tenantId, tenantId),
        ),
      )
      .limit(1)

    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Módulo não encontrado neste tenant',
        request_id: '',
      })
    }

    await db
      .update(patientLinkModules)
      .set({ dataLevels: parsed.dataLevels, updatedAt: new Date() })
      .where(eq(patientLinkModules.id, row.id))

    // Emite evento lifecycle (Sprint 02c.4)
    await logPatientLinkEvent({
      tenantId,
      linkId: row.linkId,
      passportPassportId: row.passportId,
      patientPersonId: row.personId,
      actorKind: 'professional',
      actorUserId: session.user.id,
      eventKind: 'data_levels_changed',
      payload: {
        module: row.module,
        from: row.dataLevelsBefore,
        to: parsed.dataLevels,
      },
    })

    setAuditResource(row.id, {
      passport_id: row.passportId,
      data_levels: parsed.dataLevels,
    })

    return { ok: true as const }
  },
)

// ─── listInvites ──────────────────────────────────────────────────────
// Lista invites enviados pelo tenant (todos os status).

export const listInvites = wrapServerAction(
  { module: 'passport', action: 'invite.list' },
  async (input: unknown, { session }) => {
    const parsed = ListInvitesSchema.parse(input ?? {}) ?? { status: 'all', limit: 50 }
    const tenantId = session.logifit.tenantId

    const conditions = [eq(patientCompanyLinks.tenantId, tenantId)]
    if (parsed.status !== 'all') {
      conditions.push(eq(patientCompanyLinks.status, parsed.status))
    }

    const rows = await db
      .select({
        id: patientCompanyLinks.id,
        passportPassportId: patientCompanyLinks.passportPassportId,
        personId: patientCompanyLinks.personId,
        personName: persons.name,
        status: patientCompanyLinks.status,
        creationPath: patientCompanyLinks.creationPath,
        invitedAt: patientCompanyLinks.invitedAt,
        acceptedAt: patientCompanyLinks.acceptedAt,
        revokedAt: patientCompanyLinks.revokedAt,
      })
      .from(patientCompanyLinks)
      .innerJoin(persons, eq(persons.id, patientCompanyLinks.personId))
      .where(and(...conditions))
      .orderBy(desc(patientCompanyLinks.invitedAt))
      .limit(parsed.limit)

    return { ok: true as const, rows }
  },
)

// ─── getCrossTenantSummary ────────────────────────────────────────────
// Consulta cross-tenant via has_cross_tenant_access() + grava audit log.
// Retorna `{ allowed: boolean, reason?: string }` — caller leitor de dado
// roda apenas se allowed=true.
//
// **Audit log obrigatório** (regra 42 + lint cross-tenant-read-must-log).

export const getCrossTenantSummary = wrapServerAction(
  { module: 'passport', action: 'cross_tenant.read_check' },
  async (input: z.infer<typeof CrossTenantReadSchema>, { session }) => {
    const parsed = CrossTenantReadSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const userId = session.user.id

    // Chama função SQL has_cross_tenant_access
    const r = await pool.query<{ allowed: boolean }>(
      `SELECT has_cross_tenant_access($1::uuid, $2::uuid, $3::uuid, $4::passport_module, $5::text) AS allowed`,
      [userId, tenantId, parsed.passportPassportId, parsed.module, parsed.category],
    )
    const allowed = r.rows[0]?.allowed === true

    // Resolve source_tenant_id via primeiro link ativo do passport (fora deste tenant)
    let sourceTenantId: string | null = null
    if (allowed) {
      const [link] = await db
        .select({ tenantId: patientCompanyLinks.tenantId, personId: patientCompanyLinks.personId })
        .from(patientCompanyLinks)
        .where(
          and(
            eq(patientCompanyLinks.passportPassportId, parsed.passportPassportId),
            eq(patientCompanyLinks.status, 'active'),
            sql`${patientCompanyLinks.revokedAt} IS NULL`,
            sql`${patientCompanyLinks.tenantId} != ${tenantId}`,
          ),
        )
        .limit(1)
      sourceTenantId = link?.tenantId ?? null

      // Audit log (regra 42 — append-only via tabela sem UPDATE policy)
      if (sourceTenantId && link?.personId) {
        await db.insert(patientDataAccessLog).values({
          readerUserId: userId,
          readerTenantId: tenantId,
          sourceTenantId,
          patientPersonId: link.personId,
          passportPassportId: parsed.passportPassportId,
          moduleType: parsed.module,
          category: parsed.category,
          resourceType: parsed.resourceType,
          resourceId: parsed.resourceId ?? null,
          requestId: randomUUID(),
        })
      }
    }

    return {
      ok: true as const,
      allowed,
      sourceTenantId,
      reason: allowed
        ? null
        : ['financeiro', 'prontuario_cfm_bruto', 'terceiros_mencionados', 'workspace'].includes(
              parsed.category,
            )
          ? 'hard_limit'
          : 'no_link_or_module',
    }
  },
)

// ─── sendPatientInviteSimple (UI helper — Sprint 02b8) ──────────────────

/**
 * Wrapper simplificado de `sendPatientInvite` pra UI staff (`/app/passport/invites/new`).
 *
 * Resolve `passportPassportId` automaticamente:
 *   1. Se person tem `passport_global_identity_id` (Sprint 02b2 ADR 0093) → usa esse
 *   2. Senão, gera UUID determinístico via SHA-256(cpf_normalized) primeiros 16 bytes
 *      → preserva idempotência cross-tenant (mesmo CPF = mesmo passportId em N tenants)
 *
 * Constrói `modules` array com dataLevels defaults sensatos por módulo (academia
 * libera treino + antropometria; fisio/nutri liberam clínico também).
 *
 * Retorna mesma estrutura de `sendPatientInvite` (linkId + inviteUrl + emailSent
 * + whatsappShareUrl) — UI consome diretamente pra renderizar os 3 botões.
 */
const SendInviteSimpleSchema = z.object({
  personId: z.string().uuid(),
  moduleKind: ModuleEnum,
  responsibleProfessionalUserId: z.string().uuid(),
})

const DEFAULT_DATA_LEVELS_BY_MODULE: Record<ModuleKind, z.infer<typeof DataLevelsSchema>> = {
  academia: { identidade: true, antropometria: true, treino: true, clinico: false },
  personal_training: { identidade: true, antropometria: true, treino: true, clinico: false },
  pilates: { identidade: true, antropometria: false, treino: true, clinico: false },
  fisioterapia: { identidade: true, antropometria: true, treino: true, clinico: true },
  nutricao: { identidade: true, antropometria: true, treino: false, clinico: true },
}

export const sendPatientInviteSimple = wrapServerAction(
  {
    module: 'passport',
    action: 'invite.send_simple',
    resourceType: 'patient_company_links',
  },
  async (input: z.infer<typeof SendInviteSimpleSchema>, _ctx) => {
    const parsed = SendInviteSimpleSchema.parse(input)

    // Resolve passportPassportId — passport_global_identity_id existente OU hash(cpf)
    const r = await pool.query<{
      passport_global_identity_id: string | null
      document: string | null
    }>(
      `SELECT passport_global_identity_id, document
         FROM persons WHERE id = $1 LIMIT 1`,
      [parsed.personId],
    )
    const row = r.rows[0]
    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Paciente não encontrado',
        request_id: '',
      })
    }

    let passportPassportId: string
    if (row.passport_global_identity_id) {
      passportPassportId = row.passport_global_identity_id
    } else if (row.document) {
      // Hash CPF determinístico — mesmo CPF gera mesmo UUID v4 em qualquer
      // tenant (cross-tenant ADR 0077). SHA-256 primeiros 16 bytes em formato UUID.
      const cpfClean = row.document.replace(/\D/g, '')
      const hash = await import('node:crypto').then((c) =>
        c.createHash('sha256').update(`logifit-passport:${cpfClean}`).digest('hex'),
      )
      passportPassportId = [
        hash.slice(0, 8),
        hash.slice(8, 12),
        '4' + hash.slice(13, 16), // version 4
        ((Number.parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
        hash.slice(20, 32),
      ].join('-')
    } else {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Paciente sem CPF cadastrado — não dá pra gerar passportId determinístico',
        request_id: '',
      })
    }

    // Chama sendPatientInvite com payload completo
    const dataLevels = DEFAULT_DATA_LEVELS_BY_MODULE[parsed.moduleKind]
    return sendPatientInvite({
      passportPassportId,
      personId: parsed.personId,
      modules: [
        {
          module: parsed.moduleKind,
          responsibleProfessionalUserId: parsed.responsibleProfessionalUserId,
          dataLevels,
        },
      ],
    })
  },
)
