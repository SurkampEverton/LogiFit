'use server'

import { headers as nextHeaders } from 'next/headers'

import { auth } from '@repo/auth/server'
import { lookupCnpj } from '@repo/cnpj'
import { parseDocument } from '@repo/db/persons'
import {
  companies,
  persons,
  roles,
  tenants,
  units,
  userRoles,
  userTenants,
  users,
} from '@repo/db/schema'
/**
 * Server Actions do onboarding atômico (`/signup` wizard).
 *
 * `onboardTenant` cria 5 entidades em uma transação ÚNICA com RLS bypass:
 *   1. `tenants` — contrato SaaS raiz
 *   2. `persons` (matriz PJ) — cadastro central do CNPJ
 *   3. `companies` — matriz linkada a `persons.id`
 *   4. `units` — local físico inicial
 *   5. `users` — admin do tenant linkado a `auth_user.id` (BetterAuth) +
 *      `persons.id` PF do admin
 *   6. `user_tenants` — vínculo user ↔ tenant (is_default=true)
 *   7. `user_roles` — role `tenant_owner` (system) atribuída ao admin
 *
 * **RLS bypass** via `withElevatedContext()` — único lugar legítimo no MVP.
 * Sprint 02+ adiciona lint `no-elevated-context-abuse`.
 *
 * **Atomicidade**: tudo ou nada — ROLLBACK preserva DB limpo se qualquer
 * passo falhar (ex.: CNPJ duplicado em outro tenant viola
 * `companies_person_per_tenant_uq`).
 */
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { z } from 'zod'
import { withElevatedContext } from '../../lib/session'

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

const onboardTenantInputSchema = z.object({
  // Empresa
  cnpj: z.string().trim().min(14).max(20),
  empresaRazaoSocial: z.string().trim().min(2).max(200),
  empresaNomeFantasia: z.string().trim().max(200).optional(),
  empresaTenantSlug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'slug inválido: a-z, 0-9 e hífen apenas'),

  // Unidade
  unitName: z.string().trim().min(2).max(100),
  unitAddress: z
    .object({
      cep: z.string().optional(),
      logradouro: z.string().optional(),
      numero: z.string().optional(),
      complemento: z.string().optional(),
      bairro: z.string().optional(),
      cidade: z.string().optional(),
      uf: z.string().length(2).optional(),
    })
    .default({}),

  // Admin
  adminEmail: z.string().trim().email(),
  adminName: z.string().trim().min(2).max(200),
  adminCpf: z.string().trim().optional(),
})

export interface OnboardResult {
  tenantId: string
  companyId: string
  unitId: string
  userId: string
  authUserId: string
  magicLinkSent: boolean
}

// wrap-exempt: Sprint 01a Faixa E — envelope manual; Faixa F migra pra wrapAction()
export async function onboardTenant(
  rawInput: z.input<typeof onboardTenantInputSchema>,
): Promise<ActionResult<OnboardResult>> {
  const parsed = onboardTenantInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'dados inválidos',
        details: parsed.error.flatten(),
      },
    }
  }
  const input = parsed.data

  // 1. Valida CNPJ
  const cnpjDoc = parseDocument(input.cnpj)
  if (!cnpjDoc.ok || cnpjDoc.kind !== 'pj') {
    return {
      ok: false,
      error: { code: 'INVALID_CNPJ', message: 'CNPJ inválido' },
    }
  }
  const cnpjNormalized = cnpjDoc.normalized

  // 2. Valida CPF opcional do admin
  let cpfNormalized: string | null = null
  if (input.adminCpf) {
    const cpfDoc = parseDocument(input.adminCpf)
    if (!cpfDoc.ok || cpfDoc.kind !== 'pf') {
      return {
        ok: false,
        error: { code: 'INVALID_CPF', message: 'CPF do admin inválido' },
      }
    }
    cpfNormalized = cpfDoc.normalized
  }

  // 3. Try cache CNPJ data pra preencher endereço da empresa se user não forneceu
  //    (não bloqueia onboarding se Receita estiver offline)
  let cnpjData: Awaited<ReturnType<typeof lookupCnpj>> | null = null
  try {
    cnpjData = await lookupCnpj(cnpjNormalized)
  } catch {
    /* não bloqueia */
  }

  // 4. Cria/recupera auth_user no BetterAuth (envio magic link assume conta)
  //    Sprint 01a Faixa E: BetterAuth signIn.magicLink cria auth_user se não existe.
  //    Aqui usamos `auth.api.signInMagicLink` programaticamente — Sprint 02+
  //    refatora pra fluxo "criar tenant pendente → user confirma email".
  let authUserId: string
  let magicLinkSent = false
  try {
    // BetterAuth helper: createUser direto (sem magic link) pra termos auth_user.id
    // antes de mandar email. Sprint 02+ avalia se prefere user confirmar email
    // ANTES de criar tenant (anti-spam).
    const reqHeaders = await nextHeaders()
    const created = await auth.api.signUpEmail({
      body: {
        email: input.adminEmail,
        password: cryptoRandomString(32), // password aleatório — user usa magic link
        name: input.adminName,
      },
      headers: reqHeaders,
    })
    authUserId = created.user.id
  } catch (err) {
    // Email já existe → recupera o auth_user pra continuar onboarding (cenário:
    // user já tem outro tenant; está criando segundo). Sprint 02+ pluga aqui o
    // fluxo de multi-tenant signup (`select-tenant` page após login).
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: {
        code: 'EMAIL_ALREADY_USED',
        message:
          'Este email já tem conta. Faça login e use /select-tenant pra criar segundo tenant (Sprint 02+).',
        details: { cause: msg.slice(0, 100) },
      },
    }
  }

  // 5. TRANSACTION elevada: cria todas as 7 entidades atomicamente
  try {
    const result = await withElevatedContext(authUserId, async (client) => {
      const db = drizzle(client)

      // 5a. tenant
      const [tenantRow] = await db
        .insert(tenants)
        .values({
          name: input.empresaRazaoSocial,
          slug: input.empresaTenantSlug,
          topology: 'owned',
          financialMode: 'centralized',
          crossCompanyAccess: false,
          subscriptionStatus: 'trialing',
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // ADR 0066 — 14d
        })
        .returning()
      if (!tenantRow) throw new Error('tenant INSERT retornou vazio')

      // 5b. persons matriz PJ
      const [personPjRow] = await db
        .insert(persons)
        .values({
          tenantId: tenantRow.id,
          kind: 'pj',
          name: input.empresaRazaoSocial,
          displayName: input.empresaNomeFantasia ?? null,
          document: cnpjNormalized,
          email: cnpjData?.ok ? cnpjData.data.email : null,
          phone: cnpjData?.ok ? cnpjData.data.telefone : null,
          address: cnpjData?.ok
            ? cnpjData.data.address
            : input.unitAddress
              ? input.unitAddress
              : null,
        })
        .returning()
      if (!personPjRow) throw new Error('persons (PJ) INSERT retornou vazio')

      // 5c. company matriz
      const [companyRow] = await db
        .insert(companies)
        .values({
          tenantId: tenantRow.id,
          personId: personPjRow.id,
          type: 'matriz',
          parentCompanyId: null,
        })
        .returning()
      if (!companyRow) throw new Error('companies INSERT retornou vazio')

      // 5d. unit inicial
      const [unitRow] = await db
        .insert(units)
        .values({
          tenantId: tenantRow.id,
          companyId: companyRow.id,
          name: input.unitName,
          address: input.unitAddress,
        })
        .returning()
      if (!unitRow) throw new Error('units INSERT retornou vazio')

      // 5e. persons admin PF
      const [personPfRow] = await db
        .insert(persons)
        .values({
          tenantId: tenantRow.id,
          kind: 'pf',
          name: input.adminName,
          document: cpfNormalized,
          email: input.adminEmail,
        })
        .returning()
      if (!personPfRow) throw new Error('persons (PF) INSERT retornou vazio')

      // 5f. users (LogiFit operator)
      const [userRow] = await db
        .insert(users)
        .values({
          tenantId: tenantRow.id,
          personId: personPfRow.id,
          authUserId: sql`${authUserId}::uuid`,
          username: input.adminEmail,
          mfaEnabled: false,
        })
        .returning()
      if (!userRow) throw new Error('users INSERT retornou vazio')

      // 5g. user_tenants (vínculo default)
      await db.insert(userTenants).values({
        userId: userRow.id,
        tenantId: tenantRow.id,
        isDefault: true,
      })

      // 5h. user_roles → tenant_owner (system role)
      const [tenantOwnerRole] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, 'tenant_owner'))
        .limit(1)
      if (!tenantOwnerRole) {
        throw new Error(
          'system role "tenant_owner" não encontrada — rode db:migrate pra aplicar seed RBAC',
        )
      }
      await db.insert(userRoles).values({
        tenantId: tenantRow.id,
        userId: userRow.id,
        roleId: tenantOwnerRole.id,
        scopeCompanyId: null,
        scopeUnitId: null,
        grantedAt: new Date(),
        grantedBy: null,
      })

      return {
        tenantId: tenantRow.id,
        companyId: companyRow.id,
        unitId: unitRow.id,
        userId: userRow.id,
        authUserId,
      }
    })

    // 6. Envia magic link pro admin (BetterAuth)
    //    Errors aqui não revertem o tenant (já criado); UI mostra "tenta de
    //    novo na tela de login".
    try {
      // wrap-exempt: API interna BetterAuth — não é Server Action LogiFit
      const reqHeaders = await nextHeaders()
      await auth.api.signInMagicLink({
        body: {
          email: input.adminEmail,
          callbackURL: `/app`,
        },
        headers: reqHeaders,
      })
      magicLinkSent = true
    } catch {
      magicLinkSent = false
    }

    return { ok: true, data: { ...result, magicLinkSent } }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes('tenants_slug_uq')) {
      return {
        ok: false,
        error: { code: 'SLUG_TAKEN', message: 'Este subdomínio já está em uso' },
      }
    }
    if (
      msg.includes('companies_person_per_tenant_uq') ||
      msg.includes('persons_tenant_document_uq')
    ) {
      return {
        ok: false,
        error: { code: 'CNPJ_TAKEN', message: 'CNPJ já cadastrado em outro tenant' },
      }
    }

    return {
      ok: false,
      error: { code: 'INTERNAL', message: msg.slice(0, 200) },
    }
  }
}

/**
 * Helper: gera string aleatória criptograficamente segura.
 * Usado pra password aleatória do auth_user (que vai usar magic link, não senha).
 */
function cryptoRandomString(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, len)
}
