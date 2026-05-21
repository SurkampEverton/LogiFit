import { expect, test } from '@playwright/test'
import {
  closePassportPool,
  createTestPassportIdentity,
  deleteTestPassportIdentity,
  type TestPassportIdentity,
} from '../helpers/test-passport-identity'
import {
  closePool,
  createTestMember,
  deleteTestMember,
  type TestMember,
} from '../helpers/test-member'

/**
 * smoke/meu-portal-routes — varre todas as paginas /meu/* protegidas pra
 * detectar quebras de session/render.
 *
 * Motivacao: durante Sprint 02b5 (commit d922e7e) foi descoberto bug
 * critico no middleware checava cookie staff em /meu/* ao inves de
 * cookies member/passport. Bug nunca aparecia porque smoke tests
 * usavam so API endpoints, nao navegacao UI nas pages.
 *
 * Garante regressao prevenida cada page.tsx em /meu (excluindo login
 * pre-auth) e exercitada com session apropriada e deve:
 *   - NAO redirecionar pra /login ou /meu/login (cookie perdido)
 *   - Renderizar 200 OK (nao 500 server error)
 *
 * **2 grupos de rotas** (descoberto 2026-05-21):
 *   - PASSPORT_SUPPORTED: usam getActiveSession (passport + member) —
 *     funcionam pra paciente cadastrado via Path B proativo
 *   - MEMBER_ONLY: usam requireMemberSession (Sprint 26 legacy) —
 *     só funcionam pra paciente com vinculo clinico (tenant + member)
 *
 * **Gap conhecido (Sprint 02b6 candidato):** 21 paginas em MEMBER_ONLY
 * precisam migrar pra getActiveSession pra suportar passport session.
 * Spinoff task criado durante Sprint 02b5.
 *
 * Nao testa: conteudo visual, interatividade, fluxos completos.
 */

/** Rotas que ja foram migradas pra getActiveSession (passport-aware). */
const PASSPORT_SUPPORTED_ROUTES = [
  '/meu',
  '/meu/perfil',
  '/meu/perfil/email-trocado',
]

/**
 * Rotas que ainda usam requireMemberSession (Sprint 26 legacy).
 * Falham com session passport pura — precisam de session member (paciente
 * vinculado a tenant). Spinoff Sprint 02b6 migra pra getActiveSession.
 */
const MEMBER_ONLY_ROUTES = [
  '/meu/agenda',
  '/meu/agenda/novo',
  '/meu/alertas',
  '/meu/convidar',
  '/meu/diario',
  '/meu/diario/novo',
  '/meu/dispositivos',
  '/meu/dispositivos/historico',
  '/meu/dispositivos/importar',
  '/meu/exames',
  '/meu/exames/upload',
  '/meu/financeiro',
  '/meu/privacidade',
  '/meu/privacidade/acessos',
  '/meu/privacidade/alertas-cruzados',
  '/meu/privacidade/compartilhamento',
  '/meu/privacidade/incidentes',
  '/meu/qr',
  '/meu/recibos',
  '/meu/treino',
]

/**
 * Rotas em estado quebrado (bug arquitetural conhecido — não testadas).
 *
 * - `/meu/sessoes`: Sprint 01a Faixa C skeleton usa `auth.api.getSession`
 *   (STAFF BetterAuth) mas está montado em `/meu/*` (path de paciente).
 *   Redireciona pra `/login` (staff). Deveria ser `/app/sessoes` OU
 *   migrar pra session member/passport. Funcionalidade equivalente já
 *   existe em `/meu/perfil` (PassportSessionRevokeButton). Spinoff: remover
 *   rota duplicada OU consolidar com /meu/perfil.
 */
// const KNOWN_BROKEN_ROUTES = ['/meu/sessoes']

// ─── Suite A: passport-aware (Sprint 02b4 padrão) ─────────────────────

test.describe('Portal /meu/* - rotas passport-aware', () => {
  let identity: TestPassportIdentity

  test.beforeAll(async () => {
    const uniq = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    identity = await createTestPassportIdentity({
      email: 'e2e-portal-passport-' + uniq + '@logifit.test',
      emailVerified: true,
      withSession: true,
      mfaVerified: true,
    })
  })

  test.afterAll(async () => {
    if (identity) await deleteTestPassportIdentity(identity)
    await closePassportPool()
  })

  for (const route of PASSPORT_SUPPORTED_ROUTES) {
    test('renderiza ' + route + ' com session passport', async ({ page, context }) => {
      await context.addCookies([
        {
          name: 'lf_passport_session',
          value: identity.sessionToken as string,
          url: 'http://localhost:3100/meu',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ])

      const response = await page.goto(route)
      expect(response).not.toBeNull()
      expect(response && response.status()).toBe(200)
      expect(page.url()).not.toContain('/login')
    })
  }
})

// ─── Suite B: member-only (Sprint 26 legacy) ─────────────────────────

test.describe('Portal /meu/* - rotas member-only (Sprint 26)', () => {
  let member: TestMember

  test.beforeAll(async () => {
    const uniq = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    member = await createTestMember({
      email: 'e2e-portal-member-' + uniq + '@logifit.test',
      name: 'E2E Portal Member',
    })
  })

  test.afterAll(async () => {
    if (member) await deleteTestMember(member)
    await closePool()
  })

  /**
   * Cria session member via SQL (helper test-member não cria sessions).
   * Token plano = refresh, hash SHA-256 grava em member_sessions.
   */
  async function setupMemberSession(): Promise<string> {
    const crypto = await import('node:crypto')
    const tokenBytes = crypto.randomBytes(32)
    const token = tokenBytes.toString('base64url')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    // Reusa pool de test-member via raw query (workaround pra helper não expor pool)
    const { Pool } = await import('pg')
    const p = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/logifit',
    })
    const c = await p.connect()
    try {
      await c.query('SET row_security = off')
      await c.query(
        `INSERT INTO member_sessions (tenant_id, member_id, refresh_token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days')`,
        [member.tenantId, member.memberId, tokenHash],
      )
    } finally {
      c.release()
      await p.end()
    }
    return token
  }

  for (const route of MEMBER_ONLY_ROUTES) {
    test('renderiza ' + route + ' com session member', async ({ page, context }) => {
      const token = await setupMemberSession()
      await context.addCookies([
        {
          name: 'lf_member_session',
          value: token,
          url: 'http://localhost:3100/meu',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ])

      const response = await page.goto(route)
      expect(response).not.toBeNull()
      expect(response && response.status()).toBe(200)
      expect(page.url()).not.toContain('/login')
    })
  }
})
