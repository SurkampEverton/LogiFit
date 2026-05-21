import { expect, test } from '@playwright/test'
import {
  closePassportPool,
  createTestPassportIdentity,
  deleteTestPassportIdentity,
  type TestPassportIdentity,
} from '../helpers/test-passport-identity'

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
 * pre-auth) e exercitada com session passport real e deve:
 *   - NAO redirecionar pra /login ou /meu/login (cookie perdido)
 *   - Renderizar 200 OK (nao 500 server error)
 *
 * Nao testa: conteudo visual, interatividade, fluxos completos.
 */

const STATIC_PROTECTED_ROUTES = [
  '/meu',
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
  '/meu/perfil',
  '/meu/perfil/email-trocado',
  '/meu/privacidade',
  '/meu/privacidade/acessos',
  '/meu/privacidade/alertas-cruzados',
  '/meu/privacidade/compartilhamento',
  '/meu/privacidade/incidentes',
  '/meu/qr',
  '/meu/recibos',
  '/meu/sessoes',
  '/meu/treino',
]

test.describe('Portal do paciente - todas as rotas /meu/* abrem com session', () => {
  let identity: TestPassportIdentity

  test.beforeAll(async () => {
    const uniq = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    identity = await createTestPassportIdentity({
      email: 'e2e-portal-' + uniq + '@logifit.test',
      emailVerified: true,
      withSession: true,
      mfaVerified: true,
    })
  })

  test.afterAll(async () => {
    if (identity) await deleteTestPassportIdentity(identity)
    await closePassportPool()
  })

  for (const route of STATIC_PROTECTED_ROUTES) {
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
