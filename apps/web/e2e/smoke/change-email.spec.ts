import { expect, test } from '@playwright/test'
import {
  deleteAllMessages,
  waitForMessage,
} from '../helpers/mailhog'
import {
  closePassportPool,
  createTestPassportIdentity,
  deleteTestPassportIdentity,
  insertEmailVerificationToken,
  readIdentity,
  type TestPassportIdentity,
} from '../helpers/test-passport-identity'

/**
 * smoke/change-email — fluxo change_email do passport identity (Sprint 02b5).
 *
 * Testa apenas a parte PRÉ-AUTH (confirmPassportEmailChange) — o request
 * flow exige session passport + MFA + password verify e é coberto pelo
 * smoke .mjs em scripts/.
 *
 * Cenário:
 *   1. Cria identity passport com email "old"
 *   2. INSERT direto de token kind='change_email' + new_email
 *   3. Limpa Mailhog inbox
 *   4. GET /api/meu/perfil/email/confirm-change?t=<token>
 *      → redirect 307 /meu/perfil/email-trocado
 *   5. Asserta DB: identity.email == new_email + email_verified_at setado
 *   6. Asserta Mailhog: notificação chegou no OLD email com warning
 */
test.describe('Portal do paciente — change_email confirmation', () => {
  let identity: TestPassportIdentity

  test.beforeEach(async () => {
    // Email único por test pra evitar colisões entre re-runs ou seed lixo
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    identity = await createTestPassportIdentity({
      email: `change-old-${uniq}@logifit.test`,
      emailVerified: true, // simula state pós-signup completo
    })
  })

  test.afterEach(async () => {
    await deleteTestPassportIdentity(identity)
  })

  test.afterAll(async () => {
    await closePassportPool()
  })

  test('confirma troca de email → notifica old email + atualiza identity', async ({
    request,
  }) => {
    const newEmail = `change-new-${Date.now()}@logifit.test`

    // 2. INSERT token change_email
    const { token } = await insertEmailVerificationToken({
      identityId: identity.identityId,
      email: identity.email, // snapshot do old email
      kind: 'change_email',
      newEmail,
    })

    // 3. Limpa Mailhog inbox
    await deleteAllMessages()

    // 4. GET confirm route handler — segue redirect manualmente pra validar destino
    const res = await request.get(`/api/meu/perfil/email/confirm-change?t=${token}`, {
      maxRedirects: 0,
    })
    expect([302, 307, 308]).toContain(res.status())
    const location = res.headers()['location']
    expect(location).toContain('/meu/perfil/email-trocado')

    // 5. Asserta DB: identity.email mudou + email_verified_at setado
    const after = await readIdentity(identity.identityId)
    expect(after).toBeTruthy()
    expect(after!.email.toLowerCase()).toBe(newEmail.toLowerCase())
    expect(after!.email_verified_at).toBeTruthy()

    // 6. Asserta notificação chegou no OLD email
    const notif = await waitForMessage({
      to: identity.email,
      subjectIncludes: 'alterado',
      timeoutMs: 3000,
    })
    expect(notif).toBeDefined()
    const from = notif.Content.Headers.From?.[0] ?? ''
    expect(from).toContain('no-reply@logifit.com.br')
  })

  test('token expirado retorna erro amigável (redirect email-erro)', async ({
    request,
  }) => {
    // Insere token já expirado (ttl negativa)
    const { token } = await insertEmailVerificationToken({
      identityId: identity.identityId,
      email: identity.email,
      kind: 'change_email',
      newEmail: `change-new-${Date.now()}@logifit.test`,
      ttlHours: -1, // já expirou
    })

    const res = await request.get(`/api/meu/perfil/email/confirm-change?t=${token}`, {
      maxRedirects: 0,
    })
    expect([302, 307, 308]).toContain(res.status())
    const location = res.headers()['location']
    expect(location).toContain('/cadastro/email-erro')
    expect(location).toContain('reason=')

    // DB não mudou
    const after = await readIdentity(identity.identityId)
    expect(after!.email.toLowerCase()).toBe(identity.email.toLowerCase())
  })

  test('token inválido (não existe) redireciona pra email-erro sem 500', async ({
    request,
  }) => {
    const res = await request.get('/api/meu/perfil/email/confirm-change?t=invalid-token-xyz', {
      maxRedirects: 0,
    })
    expect([302, 307, 308]).toContain(res.status())
    const location = res.headers()['location']
    expect(location).toContain('/cadastro/email-erro')
  })

  test('token kind=signup NÃO funciona pra change_email (Sprint 02b4 isolation)', async ({
    request,
  }) => {
    // Insere token kind='signup' (não change_email)
    const { token } = await insertEmailVerificationToken({
      identityId: identity.identityId,
      email: identity.email,
      kind: 'signup',
    })

    const res = await request.get(`/api/meu/perfil/email/confirm-change?t=${token}`, {
      maxRedirects: 0,
    })
    // Deve dar erro — confirmPassportEmailChange filtra kind='change_email'
    expect([302, 307, 308]).toContain(res.status())
    const location = res.headers()['location']
    expect(location).toContain('/cadastro/email-erro')

    // Identity intacta
    const after = await readIdentity(identity.identityId)
    expect(after!.email.toLowerCase()).toBe(identity.email.toLowerCase())
  })
})
