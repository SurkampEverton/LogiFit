import { expect, test } from '@playwright/test'
import {
  deleteAllMessages,
  extractUrlFromBody,
  waitForMessage,
} from '../helpers/mailhog'
import { closePool, createTestMember, deleteTestMember, type TestMember } from '../helpers/test-member'

/**
 * smoke/meu-magic-link — fluxo magic link do portal do paciente (Sprint 26 +
 * Sprint 02b4 com @repo/email Brevo ADR 0096).
 *
 * **Bloqueia merge** se falhar (ADR 0090 §6 — Top-10 smoke).
 *
 * Cenário:
 *   1. Setup: cria member de teste em academia-equilibrio (helper test-member)
 *   2. Limpa Mailhog inbox pra começar estado consistente
 *   3. POST /api/meu/magic-link → resposta {ok:true, sent:true}
 *   4. Mailhog recebe email com From=LogiFit + Subject=link de acesso
 *   5. Extrai token plano do email (decodifica quoted-printable)
 *   6. POST /api/meu/verify → resposta {ok:true, memberId, tenantId}
 *   7. Cleanup: deleta member + tokens
 *
 * Pré-requisitos (rodar antes via `pnpm dev:up` + `pnpm dev`):
 *   - Postgres rodando (DATABASE_URL no .env.local) com seed canônico
 *   - Mailhog rodando (porta 1025 SMTP + 8025 API)
 *   - Next.js dev server rodando (PLAYWRIGHT_BASE_URL ou default :3000)
 *   - Pelo menos 1 tenant 'academia-equilibrio' (vem do pnpm db:seed)
 *
 * Não testado aqui (cobertos por unit tests do @repo/email):
 *   - Render visual do template HTML
 *   - Rate limit/anti-enumeration de múltiplas requests rápidas
 *   - Fallback SQL quando Redis indisponível
 */
test.describe('Portal do paciente — magic link end-to-end', () => {
  let member: TestMember

  test.beforeAll(async () => {
    member = await createTestMember({
      email: `e2e-magic-link-${Date.now()}@logifit.test`,
      name: 'E2E Magic Link Test',
    })
  })

  test.afterAll(async () => {
    await deleteTestMember(member)
    await closePool()
  })

  test('solicita magic link → email no Mailhog → verifica token → cria session', async ({
    request,
  }) => {
    // 2. Limpa inbox pra estado consistente
    await deleteAllMessages()

    // 3. POST /api/meu/magic-link
    const reqRes = await request.post('/api/meu/magic-link', {
      data: {
        email: member.email,
        tenantSlug: member.tenantSlug,
      },
    })
    expect(reqRes.status()).toBe(200)
    const reqBody = (await reqRes.json()) as { ok: boolean; sent: boolean }
    expect(reqBody.ok).toBe(true)
    expect(reqBody.sent).toBe(true)

    // 4. Aguarda email chegar no Mailhog
    const msg = await waitForMessage({
      to: member.email,
      subjectIncludes: 'link de acesso',
      timeoutMs: 5000,
    })
    expect(msg).toBeDefined()

    // Valida From + Reply-To padrão LogiFit (category 'platform')
    const fromHeader = msg.Content.Headers.From?.[0] ?? ''
    expect(fromHeader).toContain('no-reply@logifit.com.br')
    expect(fromHeader).toContain('LogiFit')

    // 5. Extrai token plano (decodifica quoted-printable)
    const url = extractUrlFromBody(msg.Content.Body, /verify\?t=([A-Za-z0-9_-]+)/)
    expect(url).not.toBeNull()
    const tokenMatch = url?.match(/t=([A-Za-z0-9_-]+)/)
    const token = tokenMatch?.[1]
    expect(token).toBeDefined()
    expect(token!.length).toBeGreaterThan(20) // base64url de 32 bytes = ~43 chars

    // 6. POST /api/meu/verify
    const verifyRes = await request.post('/api/meu/verify', {
      data: { token },
    })
    expect(verifyRes.status()).toBe(200)
    const verifyBody = (await verifyRes.json()) as {
      ok: boolean
      memberId?: string
      tenantId?: string
    }
    expect(verifyBody.ok).toBe(true)
    expect(verifyBody.memberId).toBe(member.memberId)
    expect(verifyBody.tenantId).toBe(member.tenantId)
  })

  test('token usado retorna erro na segunda tentativa (single-use)', async ({ request }) => {
    await deleteAllMessages()

    // Pede magic link
    const reqRes = await request.post('/api/meu/magic-link', {
      data: { email: member.email, tenantSlug: member.tenantSlug },
    })
    expect(reqRes.status()).toBe(200)

    // Pega token
    const msg = await waitForMessage({
      to: member.email,
      subjectIncludes: 'link de acesso',
    })
    const url = extractUrlFromBody(msg.Content.Body, /verify\?t=([A-Za-z0-9_-]+)/)
    const token = url?.match(/t=([A-Za-z0-9_-]+)/)?.[1]!

    // 1ª verify — sucesso
    const v1 = await request.post('/api/meu/verify', { data: { token } })
    expect(v1.status()).toBe(200)

    // 2ª verify com mesmo token — deve falhar (single-use)
    const v2 = await request.post('/api/meu/verify', { data: { token } })
    expect(v2.status()).toBe(500) // ApiException código mapeado pra 500 na route handler
    const v2Body = (await v2.json()) as { ok: boolean; error?: { message?: string } }
    expect(v2Body.ok).toBe(false)
    expect(v2Body.error?.message).toMatch(/já utilizado|expirado|inválido/i)
  })
})
