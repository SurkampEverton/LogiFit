/**
 * resolveFiscalProvider — factory de provider fiscal por tenant (Sprint 36b, ADR 0059).
 *
 * Resolve credenciais em `fiscal_provider_credentials`, decifra o token
 * (AES-256-GCM columnar — @repo/security) e instancia o adapter real.
 *
 * **Bloqueio de mock em produção (regra do backbone 36a):** sem credenciais
 * ativas, dev/test caem no `MockFiscalProvider`; produção lança FORBIDDEN —
 * jamais emite nota fake em prod.
 *
 * O token decifrado vive só no escopo da chamada (nunca em log, nunca no
 * envelope de retorno — sanitize do wrapAction já redige `api_token`).
 */

import {
  FOCUS_NFE_HOSTS,
  type FiscalProvider,
  FocusNfeProvider,
  classifyFiscalAsset,
  mockFiscalProvider,
} from '@repo/ai'
import { db } from '@repo/db/client'
import { fiscalProviderCredentials } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { decryptSecretParts, safeFetch } from '@repo/security'
import { and, eq } from 'drizzle-orm'

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * Resolve o provider fiscal configurado do tenant.
 *
 * @throws ApiException FORBIDDEN em produção sem credenciais ativas.
 */
export async function resolveFiscalProvider(tenantId: string): Promise<FiscalProvider> {
  const [creds] = await db
    .select()
    .from(fiscalProviderCredentials)
    .where(
      and(
        eq(fiscalProviderCredentials.tenantId, tenantId),
        eq(fiscalProviderCredentials.provider, 'focus_nfe'),
        eq(fiscalProviderCredentials.active, true),
      ),
    )
    .limit(1)

  if (!creds) {
    if (isProduction()) {
      throw new ApiException({
        code: 'FORBIDDEN',
        message:
          'Credenciais fiscais não configuradas — configure o Focus NFe em Configurações → Fiscal.',
        request_id: '',
      })
    }
    return mockFiscalProvider
  }

  const apiToken = decryptSecretParts({
    encrypted: creds.apiTokenEncrypted,
    nonce: creds.apiTokenNonce,
    tag: creds.apiTokenTag,
  })

  // Produção exige env producao — credencial homologação em prod é erro de config
  if (isProduction() && creds.environment !== 'producao') {
    throw new ApiException({
      code: 'FORBIDDEN',
      message:
        'Credenciais fiscais em ambiente de homologação — troque para produção em Configurações → Fiscal.',
      request_id: '',
    })
  }

  return new FocusNfeProvider({
    apiToken,
    env: creds.environment,
    baseHost: creds.baseUrl ? new URL(creds.baseUrl).hostname : null,
  })
}

/**
 * Decifra o webhook secret do tenant pra verificação HMAC no callback.
 * Retorna null quando não configurado (callback rejeita nesse caso).
 */
export async function resolveWebhookSecret(tenantId: string): Promise<string | null> {
  const [creds] = await db
    .select({
      encrypted: fiscalProviderCredentials.webhookSecretEncrypted,
      nonce: fiscalProviderCredentials.webhookSecretNonce,
      tag: fiscalProviderCredentials.webhookSecretTag,
    })
    .from(fiscalProviderCredentials)
    .where(
      and(
        eq(fiscalProviderCredentials.tenantId, tenantId),
        eq(fiscalProviderCredentials.provider, 'focus_nfe'),
        eq(fiscalProviderCredentials.active, true),
      ),
    )
    .limit(1)

  if (!creds?.encrypted || !creds.nonce || !creds.tag) return null
  return decryptSecretParts({
    encrypted: creds.encrypted,
    nonce: creds.nonce,
    tag: creds.tag,
  })
}

/**
 * Baixa arquivo (PDF/XML) do provider fiscal — os paths que o Focus retorna
 * (`caminho_danfe`, `caminho_xml_nota_fiscal`) são relativos ao host da API
 * e exigem o mesmo Basic auth das emissões (Sprint 36b.5).
 *
 * Retorna null quando o tenant não tem credenciais reais (emissões mock não
 * têm arquivo baixável) ou quando o path não é relativo ao host Focus.
 */
export async function downloadFiscalFile(tenantId: string, path: string): Promise<Response | null> {
  const kind = classifyFiscalAsset(path)
  // Link de portal do municipio (ou vazio): nao e arquivo, nao ha o que proxyar.
  if (kind === 'external-portal' || kind === 'none') return null

  // Arquivo publico no S3 da Focus (DANFSE): host validado por classifyFiscalAsset
  // (focusnfe.s3.*.amazonaws.com), fetch SEM auth — mandar Basic quebra o S3 (400).
  if (kind === 'focus-file') {
    return safeFetch(path, {
      method: 'GET',
      allowedHosts: [new URL(path).hostname],
      timeoutMs: 30_000,
    })
  }

  // focus-relative: caminho na API da Focus, exige Basic auth do tenant.
  const [creds] = await db
    .select({
      encrypted: fiscalProviderCredentials.apiTokenEncrypted,
      nonce: fiscalProviderCredentials.apiTokenNonce,
      tag: fiscalProviderCredentials.apiTokenTag,
      environment: fiscalProviderCredentials.environment,
      baseUrl: fiscalProviderCredentials.baseUrl,
    })
    .from(fiscalProviderCredentials)
    .where(
      and(
        eq(fiscalProviderCredentials.tenantId, tenantId),
        eq(fiscalProviderCredentials.provider, 'focus_nfe'),
        eq(fiscalProviderCredentials.active, true),
      ),
    )
    .limit(1)
  if (!creds) return null

  const apiToken = decryptSecretParts({
    encrypted: creds.encrypted,
    nonce: creds.nonce,
    tag: creds.tag,
  })
  const host = creds.baseUrl ? new URL(creds.baseUrl).hostname : FOCUS_NFE_HOSTS[creds.environment]

  return safeFetch(`https://${host}${path}`, {
    method: 'GET',
    headers: {
      authorization: `Basic ${Buffer.from(`${apiToken}:`).toString('base64')}`,
    },
    allowedHosts: [FOCUS_NFE_HOSTS.producao, FOCUS_NFE_HOSTS.homologacao],
    timeoutMs: 30_000,
  })
}
