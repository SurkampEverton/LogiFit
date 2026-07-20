'use server'

/**
 * Server Actions — credenciais Focus NFe (Sprint 36b, ADR 0059 + ADR 0073 camada 4).
 *
 * Token é **write-only**: entra cifrado (AES-256-GCM columnar) e NUNCA é
 * ecoado de volta — `getFiscalCredentialsStatus` retorna só metadados
 * (configurado, ambiente, última validação). Permission `fiscal.admin`
 * exigida em todas (RLS extra em fiscal_provider_credentials reforça).
 */

import { FOCUS_NFE_HOSTS } from '@repo/ai'
import { db } from '@repo/db/client'
import {
  companies,
  fiscalNumberingSequences,
  fiscalProviderCredentials,
  persons,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { encryptSecretParts, safeFetch } from '@repo/security'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { resolveFiscalProvider } from '../../../lib/fiscal-provider'
import { resolveFocusAccountToken } from '../../../lib/focus-account'
import { requirePermission } from '../../../lib/permissions'
import { wrapServerAction } from '../../../lib/wrap-action'

const SaveCredentialsSchema = z.object({
  /** Token de **emissão** da empresa (não o de conta — ver `ownAccount`) */
  apiToken: z.string().min(8).max(512),
  environment: z.enum(['homologacao', 'producao']),
  /** Secret usado na URL do webhook registrado no Focus (gerado pela UI). */
  webhookSecret: z.string().min(16).max(128).optional(),
  baseUrl: z.string().url().optional(),
  /**
   * `true` = tenant tem conta própria na Focus e informa o próprio token de
   * CONTA; `false` = usa a conta da plataforma (ADR 0105).
   */
  ownAccount: z.boolean().optional(),
  /** Token de CONTA do tenant — obrigatório quando `ownAccount` é true */
  accountToken: z.string().min(8).max(512).optional(),
})

export const saveFiscalCredentials = wrapServerAction(
  {
    module: 'fiscal',
    action: 'credentials.save',
    resourceType: 'fiscal_provider_credentials',
  },
  async (input: z.infer<typeof SaveCredentialsSchema>, { session }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const parsed = SaveCredentialsSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // O CHECK do banco também barra, mas aqui a mensagem é útil ao operador.
    if (parsed.ownAccount && !parsed.accountToken)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message:
          'Cadastro próprio ligado exige o token de CONTA da Focus (o que gerencia empresas) — sem ele não há como cadastrar dados de empresa.',
        request_id: '',
      })

    const token = encryptSecretParts(parsed.apiToken)
    const webhook = parsed.webhookSecret ? encryptSecretParts(parsed.webhookSecret) : null
    const accountTok = parsed.accountToken ? encryptSecretParts(parsed.accountToken) : null

    const values = {
      apiTokenEncrypted: token.encrypted,
      apiTokenNonce: token.nonce,
      apiTokenTag: token.tag,
      environment: parsed.environment,
      baseUrl: parsed.baseUrl ?? null,
      ...(webhook
        ? {
            webhookSecretEncrypted: webhook.encrypted,
            webhookSecretNonce: webhook.nonce,
            webhookSecretTag: webhook.tag,
          }
        : {}),
      ownAccount: parsed.ownAccount ?? false,
      ...(accountTok
        ? {
            accountTokenEncrypted: accountTok.encrypted,
            accountTokenNonce: accountTok.nonce,
            accountTokenTag: accountTok.tag,
          }
        : {}),
      // Desligar o flag limpa o token de conta: segredo sem uso não fica guardado
      ...(parsed.ownAccount === false
        ? {
            accountTokenEncrypted: null,
            accountTokenNonce: null,
            accountTokenTag: null,
          }
        : {}),
      active: true,
      lastValidatedAt: null,
      lastValidationStatus: null,
      updatedAt: new Date(),
    }

    const [existing] = await db
      .select({ tenantId: fiscalProviderCredentials.tenantId })
      .from(fiscalProviderCredentials)
      .where(
        and(
          eq(fiscalProviderCredentials.tenantId, tenantId),
          eq(fiscalProviderCredentials.provider, 'focus_nfe'),
        ),
      )
      .limit(1)

    if (existing) {
      await db
        .update(fiscalProviderCredentials)
        .set(values)
        .where(
          and(
            eq(fiscalProviderCredentials.tenantId, tenantId),
            eq(fiscalProviderCredentials.provider, 'focus_nfe'),
          ),
        )
    } else {
      await db.insert(fiscalProviderCredentials).values({
        tenantId,
        provider: 'focus_nfe',
        ...values,
      })
    }

    return { saved: true, environment: parsed.environment }
  },
)

// ─── Credenciais do portal municipal (ADR 0105) ──────────────────────────

const SaveMunicipalCredentialsSchema = z.object({
  companyId: z.string().uuid(),
  loginPrefeitura: z.string().min(1).max(120),
  /** Nome com segmento `senha` → redigido pelo sanitize (audit_log, GlitchTip) */
  senhaPrefeitura: z.string().min(1).max(200),
  inscricaoMunicipal: z.string().max(30).optional(),
  serieRps: z.number().int().min(1).max(999).optional(),
})

/** Erro acionável quando o token de conta em uso não tem o escopo esperado. */
function focusScopeError(source: 'tenant' | 'platform'): never {
  throw new ApiException({
    code: 'FORBIDDEN',
    message:
      source === 'platform'
        ? [
            'A Focus recusou o token de conta da plataforma para gerenciar empresas.',
            'Confira o token cadastrado em Super Admin → Fiscal: precisa ser o token da',
            'CONTA (o que lista as empresas no painel), não o de emissão de uma empresa.',
          ].join(' ')
        : [
            'A Focus recusou o token de conta deste tenant.',
            'Em Configurações → Fiscal, confira o token informado no "cadastro próprio":',
            'precisa ser o da CONTA, não o de emissão de uma empresa.',
          ].join(' '),
    request_id: '',
  })
}

/**
 * Repassa à Focus as credenciais do portal municipal da company.
 *
 * **Não persiste a senha.** Ela é enviada à Focus (que precisa dela para logar
 * no portal da prefeitura em nome do contribuinte) e descartada; guardamos
 * apenas `focus_empresa_id` e `municipal_credentials_configured_at`. Senha de
 * portal municipal dá acesso a dados tributários e permite emitir em nome do
 * contribuinte — é segredo que a LogiFit escolhe não ter (ADR 0105).
 *
 * Faz `dry_run` antes de gravar: campo recusado pela Focus falha sem deixar o
 * cadastro do tenant em estado parcial.
 */
export const saveMunicipalCredentials = wrapServerAction(
  {
    module: 'fiscal',
    action: 'credentials.save_municipal',
    resourceType: 'company',
  },
  async (input: z.infer<typeof SaveMunicipalCredentialsSchema>, { session, setAuditResource }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const parsed = SaveMunicipalCredentialsSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Token de CONTA (gerencia /v2/empresas) — vem do tenant quando ele tem
    // cadastro próprio, senão da conta da plataforma. Nunca é o token de
    // emissão salvo em `api_token_*`: esse é de empresa e a Focus devolve 403.
    const account = await resolveFocusAccountToken(tenantId)

    const [company] = await db
      .select({
        id: companies.id,
        focusEmpresaId: companies.focusEmpresaId,
        cnpj: persons.document,
      })
      .from(companies)
      .innerJoin(persons, eq(persons.id, companies.personId))
      .where(and(eq(companies.id, parsed.companyId), eq(companies.tenantId, tenantId)))
      .limit(1)
    const cnpj = company?.cnpj?.replace(/\D/g, '') ?? ''
    if (!company || cnpj.length !== 14)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Company sem CNPJ válido — complete os dados fiscais da empresa antes.',
        request_id: '',
      })

    const host = FOCUS_NFE_HOSTS[account.environment]
    const authHeader = `Basic ${Buffer.from(`${account.token}:`).toString('base64')}`
    const focusFetch = (path: string, init: { method: string; body?: string }) =>
      safeFetch(`https://${host}${path}`, {
        ...init,
        headers: { authorization: authHeader, 'content-type': 'application/json' },
        allowedHosts: [FOCUS_NFE_HOSTS.producao, FOCUS_NFE_HOSTS.homologacao],
        timeoutMs: 30_000,
      })

    // 1. Resolve o cadastro na Focus por CNPJ (uma vez; depois vem do banco)
    let empresaId = company.focusEmpresaId
    if (!empresaId) {
      const listRes = await focusFetch(`/v2/empresas?cnpj=${cnpj}`, { method: 'GET' })
      if (listRes.status === 401 || listRes.status === 403) focusScopeError(account.source)
      const list = (await listRes.json().catch(() => null)) as Array<{ id?: number }> | null
      const found = Array.isArray(list) ? list[0]?.id : undefined
      if (!found)
        throw new ApiException({
          code: 'NOT_FOUND',
          message: [
            `Nenhuma empresa com CNPJ ${cnpj} encontrada na sua conta Focus NFe.`,
            'Cadastre a empresa na Focus antes de configurar as credenciais do município.',
          ].join(' '),
          request_id: '',
        })
      empresaId = String(found)
    }

    // 2. Payload — só o que o operador informou
    const body: Record<string, string> = {
      login_responsavel: parsed.loginPrefeitura,
      senha_responsavel: parsed.senhaPrefeitura,
    }
    if (parsed.inscricaoMunicipal) body.inscricao_municipal = parsed.inscricaoMunicipal
    if (parsed.serieRps) {
      const serieField =
        account.environment === 'producao' ? 'serie_nfse_producao' : 'serie_nfse_homologacao'
      body[serieField] = String(parsed.serieRps)
    }
    const payload = JSON.stringify(body)

    // 3. dry_run: campo recusado falha sem deixar cadastro parcial
    const dry = await focusFetch(`/v2/empresas/${empresaId}?dry_run=1`, {
      method: 'PUT',
      body: payload,
    })
    if (dry.status === 401 || dry.status === 403) focusScopeError(account.source)
    if (!dry.ok) {
      const detail = await dry.text().catch(() => '')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `A Focus recusou os dados (HTTP ${dry.status}): ${detail.slice(0, 300)}`,
        request_id: '',
      })
    }

    // 4. Grava de verdade
    const put = await focusFetch(`/v2/empresas/${empresaId}`, { method: 'PUT', body: payload })
    if (!put.ok) {
      const detail = await put.text().catch(() => '')
      throw new ApiException({
        code: 'SERVICE_UNAVAILABLE',
        message: `Falha ao gravar na Focus (HTTP ${put.status}): ${detail.slice(0, 300)}`,
        request_id: '',
      })
    }

    // 5. Só o vínculo e o carimbo — a senha morre aqui, não vai pro banco
    await db
      .update(companies)
      .set({
        focusEmpresaId: empresaId,
        municipalCredentialsConfiguredAt: new Date(),
        ...(parsed.inscricaoMunicipal ? { im: parsed.inscricaoMunicipal } : {}),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, company.id))

    setAuditResource(company.id, {
      focusEmpresaId: empresaId,
      environment: account.environment,
      accountSource: account.source,
      // login não é segredo; senha jamais entra aqui
      loginPrefeitura: parsed.loginPrefeitura,
    })
    return { configured: true as const, focusEmpresaId: empresaId }
  },
)

export const validateFiscalCredentials = wrapServerAction(
  {
    module: 'fiscal',
    action: 'credentials.validate',
    resourceType: 'fiscal_provider_credentials',
  },
  async (_input: Record<string, never>, { session }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const tenantId = session.logifit.tenantId

    const provider = await resolveFiscalProvider(tenantId)
    if (provider.name === 'mock') {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Nenhuma credencial Focus NFe configurada pra validar.',
        request_id: '',
      })
    }

    const health = await provider.healthCheck()
    await db
      .update(fiscalProviderCredentials)
      .set({
        lastValidatedAt: new Date(),
        lastValidationStatus: health.ok ? 'ok' : (health.message ?? 'error'),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fiscalProviderCredentials.tenantId, tenantId),
          eq(fiscalProviderCredentials.provider, 'focus_nfe'),
        ),
      )

    return { ok: health.ok, latencyMs: health.latencyMs, message: health.message }
  },
)

export const getFiscalCredentialsStatus = wrapServerAction(
  {
    module: 'fiscal',
    action: 'credentials.status',
    resourceType: 'fiscal_provider_credentials',
  },
  async (_input: Record<string, never>, { session }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const [creds] = await db
      .select({
        environment: fiscalProviderCredentials.environment,
        active: fiscalProviderCredentials.active,
        hasWebhookSecret: fiscalProviderCredentials.webhookSecretEncrypted,
        lastValidatedAt: fiscalProviderCredentials.lastValidatedAt,
        lastValidationStatus: fiscalProviderCredentials.lastValidationStatus,
        updatedAt: fiscalProviderCredentials.updatedAt,
      })
      .from(fiscalProviderCredentials)
      .where(
        and(
          eq(fiscalProviderCredentials.tenantId, session.logifit.tenantId),
          eq(fiscalProviderCredentials.provider, 'focus_nfe'),
        ),
      )
      .limit(1)

    if (!creds) return { configured: false as const }
    return {
      configured: true as const,
      environment: creds.environment,
      active: creds.active,
      hasWebhookSecret: creds.hasWebhookSecret !== null,
      lastValidatedAt: creds.lastValidatedAt?.toISOString() ?? null,
      lastValidationStatus: creds.lastValidationStatus,
      updatedAt: creds.updatedAt.toISOString(),
    }
  },
)

// ─── Séries e numeração ───────────────────────────────────────────────────

const SetNumberingSchema = z.object({
  companyId: z.string().uuid(),
  kind: z.enum([
    'nfse',
    'nfe',
    'nfce',
    'nfe_return',
    'nfe_transfer',
    'nfe_conserto_out',
    'nfe_conserto_return',
    'nfe_self_entry',
  ]),
  serie: z.number().int().min(1).max(999),
  environment: z.enum(['homologacao', 'producao']),
  nextNumero: z.number().int().min(1).max(999_999_999),
})

/**
 * Define série e próximo número de um tipo de documento.
 *
 * Necessário na migração de outro sistema: quem já emitiu até a nota 4.312
 * precisa continuar de 4.313, não recomeçar do 1. Sem esta tela a sequência
 * só nascia na primeira emissão, sempre em 1.
 *
 * **Recuar a numeração é bloqueado.** Repetir um número já usado gera dois
 * documentos com a mesma identificação na mesma série — o fisco trata como
 * duplicidade, e a segunda nota é rejeitada ou, pior, autorizada em conflito.
 * Avançar é livre: pular número é irregularidade menor, resolvida por
 * inutilização de faixa.
 */
export const setNumberingSequence = wrapServerAction(
  { module: 'fiscal', action: 'numbering.set', resourceType: 'fiscal_numbering_sequences' },
  async (input: z.infer<typeof SetNumberingSchema>, { session, setAuditResource }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const parsed = SetNumberingSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [company] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, parsed.companyId), eq(companies.tenantId, tenantId)))
      .limit(1)
    if (!company)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Empresa não encontrada neste tenant',
        request_id: '',
      })

    const { rows } = await db.execute(sql`
      SELECT id, last_used_numero
        FROM fiscal_numbering_sequences
       WHERE tenant_id = ${tenantId}
         AND company_id = ${parsed.companyId}
         AND kind = ${parsed.kind}::fiscal_emission_kind
         AND serie = ${parsed.serie}
         AND environment = ${parsed.environment}::fiscal_provider_env
       LIMIT 1
    `)
    const existing = (rows as Array<{ id: string; last_used_numero: string | null }>)[0]

    const lastUsed = existing?.last_used_numero ? Number(existing.last_used_numero) : 0
    if (existing && parsed.nextNumero <= lastUsed)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Esta série já emitiu até o nº ${lastUsed}. O próximo número precisa ser maior — repetir numeração gera duplicidade perante o fisco.`,
        request_id: '',
      })

    if (existing) {
      await db.execute(sql`
        UPDATE fiscal_numbering_sequences
           SET next_numero = ${parsed.nextNumero}, updated_at = now()
         WHERE id = ${existing.id}
      `)
    } else {
      await db.insert(fiscalNumberingSequences).values({
        tenantId,
        companyId: parsed.companyId,
        kind: parsed.kind,
        serie: parsed.serie,
        nextNumero: parsed.nextNumero,
        lastUsedNumero: parsed.nextNumero - 1,
        environment: parsed.environment,
      })
    }

    setAuditResource(parsed.companyId, {
      kind: parsed.kind,
      serie: parsed.serie,
      environment: parsed.environment,
      nextNumero: parsed.nextNumero,
    })
    return { ok: true as const }
  },
)
