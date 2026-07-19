'use server'

/**
 * Server Actions — credenciais Focus NFe (Sprint 36b, ADR 0059 + ADR 0073 camada 4).
 *
 * Token é **write-only**: entra cifrado (AES-256-GCM columnar) e NUNCA é
 * ecoado de volta — `getFiscalCredentialsStatus` retorna só metadados
 * (configurado, ambiente, última validação). Permission `fiscal.admin`
 * exigida em todas (RLS extra em fiscal_provider_credentials reforça).
 */

import { db } from '@repo/db/client'
import { fiscalProviderCredentials } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { encryptSecretParts } from '@repo/security'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { resolveFiscalProvider } from '../../../lib/fiscal-provider'
import { requirePermission } from '../../../lib/permissions'
import { wrapServerAction } from '../../../lib/wrap-action'

const SaveCredentialsSchema = z.object({
  apiToken: z.string().min(8).max(512),
  environment: z.enum(['homologacao', 'producao']),
  /** Secret usado na URL do webhook registrado no Focus (gerado pela UI). */
  webhookSecret: z.string().min(16).max(128).optional(),
  baseUrl: z.string().url().optional(),
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

    const token = encryptSecretParts(parsed.apiToken)
    const webhook = parsed.webhookSecret ? encryptSecretParts(parsed.webhookSecret) : null

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
