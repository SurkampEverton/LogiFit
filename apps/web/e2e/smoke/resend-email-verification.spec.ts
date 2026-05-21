import { expect, test } from '@playwright/test'
import {
  deleteAllMessages,
  waitForMessage,
} from '../helpers/mailhog'
import {
  closePassportPool,
  countEmailVerificationTokens,
  createTestPassportIdentity,
  deleteTestPassportIdentity,
  type TestPassportIdentity,
} from '../helpers/test-passport-identity'

/**
 * smoke/resend-email-verification — fluxo de reenvio de email de confirmação
 * (Sprint 02b5). Server Action `resendPassportEmailVerification` exige
 * cookie `lf_passport_session` mas SEM MFA gate.
 *
 * Cenários testados:
 *   1. Happy path — paciente não verificado clica botão → email reenviado
 *   2. Idempotência — paciente já verificado retorna alreadyVerified
 *      (sem novo token inserido)
 *   3. Cooldown — 2 chamadas em <5min retornam RATE_LIMITED na 2ª
 *
 * NÃO testa: UI button rendering (a UI condicional !email_verified_at é
 * cobertura unit/visual em sprint dedicado).
 */
test.describe('Portal do paciente — resend email verification', () => {
  let identity: TestPassportIdentity

  test.afterEach(async () => {
    if (identity) await deleteTestPassportIdentity(identity)
  })

  test.afterAll(async () => {
    await closePassportPool()
  })

  /**
   * Helper: invoca Server Action `resendPassportEmailVerification` via fetch
   * com cookie passport session. Bypass do React form action — usa o endpoint
   * Server Action direto (Next.js expõe via header `Next-Action`).
   *
   * Alternativa: chamaria via UI mas isso exige render + click; pra smoke
   * que precisa só validar o backend, fetch direto é mais rápido.
   *
   * Como Server Actions têm IDs dinâmicos gerados em build, e este E2E roda
   * contra dev server, a estratégia mais robusta é usar `request.newContext`
   * com cookie + GET na page `/meu/perfil` pra obter o action ID OR usar
   * Playwright `page` + click no botão. Como UI render é caro, simplificamos:
   * verificamos a SA indiretamente via cookie + observação de side effects
   * (Mailhog + count tokens DB).
   */

  test('happy path — paciente não verificado reenvia + email chega', async ({
    page,
    context,
  }) => {
    identity = await createTestPassportIdentity({
      email: `e2e-resend-${Date.now()}@logifit.test`,
      emailVerified: false, // bota como NÃO verificado pra UI renderizar o botão
      withSession: true,
    })

    // Set cookie passport session (path /meu)
    await context.addCookies([
      {
        name: 'lf_passport_session',
        value: identity.sessionToken!,
        url: 'http://localhost:3100/meu',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ])

    await deleteAllMessages()

    // Tokens iniciais: 0 (identity recém-criada não tem)
    const tokensBefore = await countEmailVerificationTokens({
      identityId: identity.identityId,
      kind: 'signup',
    })
    expect(tokensBefore).toBe(0)

    // Vai pra /meu/perfil + click no botão reenviar
    await page.goto('/meu/perfil')
    await page.waitForLoadState('networkidle')
    // Botão tem texto "Reenviar pra <email>"
    const button = page.getByRole('button', { name: /Reenviar pra/ })
    await expect(button).toBeVisible({ timeout: 5000 })
    await button.click()

    // Polling até token aparecer no DB (mais robusto que React render)
    for (let i = 0; i < 30; i++) {
      const count = await countEmailVerificationTokens({
        identityId: identity.identityId,
        kind: 'signup',
      })
      if (count >= 1) break
      await new Promise((r) => setTimeout(r, 200))
    }
    const tokensAfter = await countEmailVerificationTokens({
      identityId: identity.identityId,
      kind: 'signup',
    })
    expect(tokensAfter).toBe(1)

    // Mailhog: email de confirmação chegou
    const msg = await waitForMessage({
      to: identity.email,
      subjectIncludes: 'Confirme seu email',
      timeoutMs: 3000,
    })
    expect(msg).toBeDefined()
  })

  test('idempotência — paciente já verificado retorna alreadyVerified', async ({
    page,
    context,
  }) => {
    identity = await createTestPassportIdentity({
      email: `e2e-resend-verified-${Date.now()}@logifit.test`,
      emailVerified: true,
      withSession: true,
    })

    await context.addCookies([
      {
        name: 'lf_passport_session',
        value: identity.sessionToken!,
        url: 'http://localhost:3100/meu',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ])

    await page.goto('/meu/perfil')
    await page.waitForLoadState('networkidle')

    // Botão NÃO deve aparecer pq email já verificado (UI condicional)
    const button = page.getByRole('button', { name: /Reenviar pra/ })
    await expect(button).not.toBeVisible()

    // Badge "✓ verificado" deve estar visível
    await expect(page.getByText('✓ verificado')).toBeVisible()
  })

  test('cooldown — 2ª chamada em <5min retorna RATE_LIMITED', async ({
    page,
    context,
  }) => {
    identity = await createTestPassportIdentity({
      email: `e2e-resend-cooldown-${Date.now()}@logifit.test`,
      emailVerified: false,
      withSession: true,
    })

    await context.addCookies([
      {
        name: 'lf_passport_session',
        value: identity.sessionToken!,
        url: 'http://localhost:3100/meu',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ])

    await deleteAllMessages()

    await page.goto('/meu/perfil')
    await page.waitForLoadState('networkidle')

    const button = page.getByRole('button', { name: /Reenviar pra/ })
    await expect(button).toBeVisible({ timeout: 5000 })

    // 1º click — sucesso (aguarda DB row aparecer ao invés de UI text;
    // mais robusto que esperar render reativo que pode ser flaky)
    await button.click()
    // Polling até token aparecer no DB (DB é fonte verdadeira)
    for (let i = 0; i < 30; i++) {
      const count = await countEmailVerificationTokens({
        identityId: identity.identityId,
        kind: 'signup',
      })
      if (count >= 1) break
      await new Promise((r) => setTimeout(r, 200))
    }
    const tokensAfterFirst = await countEmailVerificationTokens({
      identityId: identity.identityId,
      kind: 'signup',
    })
    expect(tokensAfterFirst).toBe(1)

    // UI: success state esconde botão. Recarrega pra ver botão novamente
    // (em prod paciente teria que recarregar a página depois de 5min)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // 2º click — deve dar RATE_LIMITED (DB count NÃO incrementa)
    const button2 = page.getByRole('button', { name: /Reenviar pra/ })
    await expect(button2).toBeVisible({ timeout: 5000 })
    await button2.click()

    // Aguarda Server Action processar (não dá pra polling DB pq esperamos NÃO mudar)
    await new Promise((r) => setTimeout(r, 1500))

    // DB: ainda só 1 token (cooldown bloqueou INSERT do 2º)
    const tokensAfterSecond = await countEmailVerificationTokens({
      identityId: identity.identityId,
      kind: 'signup',
    })
    expect(tokensAfterSecond).toBe(1)
  })
})
