/**
 * Resolução do token de **conta** Focus NFe (ADR 0105).
 *
 * A Focus separa dois escopos, e confundi-los devolve 403:
 *   • token de CONTA   → gerencia `/v2/empresas` (é o que este módulo resolve)
 *   • token de EMPRESA → emite documentos (fica em `fiscal_provider_credentials.api_token_*`,
 *     resolvido por `resolveFiscalProvider`)
 *
 * Ordem de resolução, decidida pelo flag `own_account` do tenant:
 *   1. `own_account = true`  → token de conta do próprio tenant
 *   2. `own_account = false` → token de conta da plataforma (LogiFit)
 *
 * O segredo da plataforma vive em `fiscal_platform_credentials`, tabela global
 * cuja RLS só libera `app.role='system'` — nenhum contexto de tenant a enxerga.
 */
import { db, pool } from '@repo/db/client'
import { fiscalProviderCredentials } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { decryptSecretParts } from '@repo/security'
import { and, eq } from 'drizzle-orm'

interface PlatformRow {
  environment: string
  account_token_encrypted: string
  account_token_nonce: string
  account_token_tag: string
}

/**
 * Lê a credencial da plataforma com `app.role='system'` **na mesma conexão**.
 *
 * SQL cru de propósito: o Drizzle usa o pool global e pegaria outra conexão,
 * onde o `set_config` não valeria e a RLS bloquearia a leitura (é a mesma
 * armadilha anotada em `withSessionContext`). `SET LOCAL` dentro da transação
 * garante que o privilégio morre no COMMIT, sem vazar pro próximo request que
 * reusar esta conexão do pool.
 */
async function readPlatformCredential(): Promise<PlatformRow | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.role', 'system', true)")
    const { rows } = await client.query<PlatformRow>(
      `SELECT environment, account_token_encrypted, account_token_nonce, account_token_tag
         FROM fiscal_platform_credentials
        WHERE provider = 'focus_nfe'
        LIMIT 1`,
    )
    await client.query('COMMIT')
    return rows[0] ?? null
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* swallow */
    }
    throw err
  } finally {
    client.release()
  }
}

export interface FocusAccountCredential {
  token: string
  environment: 'homologacao' | 'producao'
  /** De onde veio — para a UI explicar o que está em uso */
  source: 'tenant' | 'platform'
}

/**
 * @throws ApiException quando nem o tenant nem a plataforma têm token de conta.
 */
export async function resolveFocusAccountToken(tenantId: string): Promise<FocusAccountCredential> {
  const [creds] = await db
    .select({
      environment: fiscalProviderCredentials.environment,
      ownAccount: fiscalProviderCredentials.ownAccount,
      encrypted: fiscalProviderCredentials.accountTokenEncrypted,
      nonce: fiscalProviderCredentials.accountTokenNonce,
      tag: fiscalProviderCredentials.accountTokenTag,
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

  if (creds?.ownAccount) {
    if (!creds.encrypted || !creds.nonce || !creds.tag)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message:
          'Cadastro próprio está ligado mas o token de conta da Focus não foi informado — preencha em Configurações → Fiscal.',
        request_id: '',
      })
    return {
      token: decryptSecretParts({
        encrypted: creds.encrypted,
        nonce: creds.nonce,
        tag: creds.tag,
      }),
      environment: creds.environment,
      source: 'tenant',
    }
  }

  // Conta da plataforma: leitura fora do contexto do tenant (RLS system-only)
  const platform = await readPlatformCredential()

  if (!platform)
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message:
        'A conta Focus NFe da plataforma ainda não foi configurada. Se este tenant tem conta própria, ligue "cadastro próprio" em Configurações → Fiscal.',
      request_id: '',
    })

  return {
    token: decryptSecretParts({
      encrypted: platform.account_token_encrypted,
      nonce: platform.account_token_nonce,
      tag: platform.account_token_tag,
    }),
    environment: platform.environment === 'homologacao' ? 'homologacao' : 'producao',
    source: 'platform',
  }
}
