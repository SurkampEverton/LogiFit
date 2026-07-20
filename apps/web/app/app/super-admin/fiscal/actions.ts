'use server'

/**
 * Server Actions — token de **conta** Focus NFe da plataforma (ADR 0105).
 *
 * Este é o segredo mais poderoso do módulo fiscal: com ele dá pra criar,
 * alterar e excluir empresas na conta Focus da LogiFit. Por isso:
 *   • gate `super_admin` (role LogiFit, não do tenant) — não basta `fiscal.admin`
 *   • cifrado AES-256-GCM columnar; a chave vive em env, fora do banco
 *   • **write-only**: `getPlatformFiscalStatus` devolve só metadados, nunca o token
 *   • linha em tabela global cuja RLS só libera `app.role='system'`
 */

import { FOCUS_NFE_HOSTS } from '@repo/ai'
import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import { encryptSecretParts, safeFetch } from '@repo/security'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

const SavePlatformTokenSchema = z.object({
  /** Token da CONTA Focus da LogiFit — gerencia /v2/empresas */
  accountToken: z.string().min(8).max(512),
  environment: z.enum(['homologacao', 'producao']),
})

/**
 * Gate de super admin. Diferente de `requirePermission`: permissions são do
 * tenant, e este segredo é da plataforma — nenhum papel de tenant alcança.
 */
function requireSuperAdmin(roles: string[]): void {
  if (!roles.includes('super_admin'))
    throw new ApiException({
      code: 'FORBIDDEN',
      message: 'Apenas super admin da LogiFit configura a conta Focus da plataforma.',
      request_id: '',
    })
}

/**
 * Executa `fn` com `app.role='system'` na MESMA conexão (SQL cru).
 *
 * O Drizzle usa pool global e pegaria outra conexão, onde o `set_config` não
 * valeria e a RLS bloquearia. `SET LOCAL` morre no COMMIT — o privilégio não
 * vaza pro próximo request que reusar a conexão.
 */
async function withSystemConnection<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.role', 'system', true)")
    const result = await fn(client)
    await client.query('COMMIT')
    return result
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

export const savePlatformFiscalToken = wrapServerAction(
  {
    module: 'fiscal',
    action: 'platform_credentials.save',
    resourceType: 'fiscal_platform_credentials',
  },
  async (input: z.infer<typeof SavePlatformTokenSchema>, { session }) => {
    requireSuperAdmin(session.logifit.roles)
    const parsed = SavePlatformTokenSchema.parse(input)

    // Valida ANTES de gravar: token que não gerencia empresas não serve de nada,
    // e descobrir isso só na primeira configuração de município seria tarde.
    const probe = await safeFetch(`https://${FOCUS_NFE_HOSTS[parsed.environment]}/v2/empresas`, {
      method: 'GET',
      headers: {
        authorization: `Basic ${Buffer.from(`${parsed.accountToken}:`).toString('base64')}`,
      },
      allowedHosts: [FOCUS_NFE_HOSTS.producao, FOCUS_NFE_HOSTS.homologacao],
      timeoutMs: 30_000,
    })
    if (probe.status === 401 || probe.status === 403)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message:
          'A Focus recusou este token para listar empresas — confira se é o token da CONTA, não o de emissão de uma empresa.',
        request_id: '',
      })

    const enc = encryptSecretParts(parsed.accountToken)
    await withSystemConnection(async (client) => {
      await client.query(
        `INSERT INTO fiscal_platform_credentials
           (provider, environment, account_token_encrypted, account_token_nonce,
            account_token_tag, last_validated_at, last_validation_status,
            updated_by_user_id, updated_at)
         VALUES ('focus_nfe', $1, $2, $3, $4, now(), $5, $6, now())
         ON CONFLICT (provider) DO UPDATE SET
           environment = EXCLUDED.environment,
           account_token_encrypted = EXCLUDED.account_token_encrypted,
           account_token_nonce = EXCLUDED.account_token_nonce,
           account_token_tag = EXCLUDED.account_token_tag,
           last_validated_at = now(),
           last_validation_status = EXCLUDED.last_validation_status,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = now()`,
        [
          parsed.environment,
          enc.encrypted,
          enc.nonce,
          enc.tag,
          probe.ok ? 'ok' : `http_${probe.status}`,
          session.logifit.userId,
        ],
      )
    })

    return { saved: true as const, environment: parsed.environment, probeOk: probe.ok }
  },
)

export const getPlatformFiscalStatus = wrapServerAction(
  {
    module: 'fiscal',
    action: 'platform_credentials.status',
    resourceType: 'fiscal_platform_credentials',
  },
  async (_input: Record<string, never>, { session }) => {
    requireSuperAdmin(session.logifit.roles)
    return await withSystemConnection(async (client) => {
      const { rows } = await client.query<{
        environment: string
        last_validated_at: Date | null
        last_validation_status: string | null
        updated_at: Date
      }>(
        `SELECT environment, last_validated_at, last_validation_status, updated_at
           FROM fiscal_platform_credentials
          WHERE provider = 'focus_nfe'
          LIMIT 1`,
      )
      const row = rows[0]
      if (!row) return { configured: false as const }
      return {
        configured: true as const,
        environment: row.environment,
        lastValidatedAt: row.last_validated_at?.toISOString() ?? null,
        lastValidationStatus: row.last_validation_status,
        updatedAt: row.updated_at.toISOString(),
      }
    })
  },
)
