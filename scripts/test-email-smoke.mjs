#!/usr/bin/env node
/**
 * Smoke test do @repo/email — envia 1 email pro Mailhog local + verifica
 * que chegou na inbox via API HTTP do Mailhog (port 8025).
 *
 * Pré-requisitos:
 *   - docker compose up -d mailhog (porta 1025 SMTP + 8025 API)
 *   - .env.local com SMTP_HOST=localhost + SMTP_PORT=1025
 *
 * Uso:
 *   node scripts/test-email-smoke.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Carrega .env.local manualmente (sem dotenv lib)
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2]
    }
  }
} catch (err) {
  console.error('[smoke] Erro carregando .env.local:', err.message)
  process.exit(1)
}

// Importa dinamicamente após env carregado (provider singleton lê env)
const { sendTransactional, resetEmailProvider } = await import(
  '../packages/email/src/send.ts'
).catch(async () => {
  // Fallback: importa do entry resolvido
  return import('../packages/email/src/index.ts')
})

// ─── Setup ───────────────────────────────────────────────────────────
resetEmailProvider?.()

const TEST_EMAIL = `smoke-test-${Date.now()}@logifit.local`

console.log('[smoke] Provider env:')
console.log('  NODE_ENV:', process.env.NODE_ENV)
console.log('  SMTP_HOST:', process.env.SMTP_HOST)
console.log('  SMTP_PORT:', process.env.SMTP_PORT)
console.log('  BREVO_SMTP_HOST:', process.env.BREVO_SMTP_HOST ?? '(unset)')
console.log()

// ─── Envia email de teste ────────────────────────────────────────────
console.log(`[smoke] Enviando email pra ${TEST_EMAIL}...`)
const result = await sendTransactional({
  to: TEST_EMAIL,
  subject: 'Smoke test @repo/email — ADR 0096 + 0097',
  htmlBody:
    '<h1>Smoke test</h1>' +
    '<p>Se você está vendo isso no Mailhog inbox, <strong>@repo/email funciona</strong>.</p>' +
    '<p>Provider: nodemailer + Mailhog SMTP local.</p>',
  textBody:
    'Smoke test\n\nSe você está vendo isso no Mailhog inbox, @repo/email funciona.\n\nProvider: nodemailer + Mailhog SMTP local.',
  category: 'platform',
})

console.log('[smoke] Result:', JSON.stringify(result, null, 2))

if (!result.ok) {
  console.error('[smoke] FALHA — envio retornou erro')
  process.exit(1)
}

// ─── Verifica na inbox do Mailhog via API HTTP ────────────────────────
console.log()
console.log('[smoke] Verificando inbox Mailhog (http://localhost:8025/api/v2/messages)...')

// Aguarda 500ms pro Mailhog processar
await new Promise((r) => setTimeout(r, 500))

const inboxRes = await fetch('http://localhost:8025/api/v2/messages?limit=10')
if (!inboxRes.ok) {
  console.error('[smoke] FALHA — Mailhog API retornou', inboxRes.status)
  process.exit(1)
}
const inbox = await inboxRes.json()

const ourEmail = inbox.items?.find((msg) =>
  msg.Raw?.To?.includes(TEST_EMAIL) ||
  msg.To?.some?.((t) => `${t.Mailbox}@${t.Domain}` === TEST_EMAIL),
)

if (!ourEmail) {
  console.error('[smoke] FALHA — email não encontrado na inbox')
  console.error('[smoke] Inbox items:', inbox.total, '(últimos 10 listados)')
  process.exit(1)
}

console.log('[smoke] ✓ Email chegou na inbox')
console.log('  Message-ID:', ourEmail.ID)
console.log('  Subject:', ourEmail.Content?.Headers?.Subject?.[0])
console.log('  From:', ourEmail.Content?.Headers?.From?.[0])
console.log('  To:', ourEmail.Content?.Headers?.To?.[0])
console.log()
console.log('[smoke] ✅ TUDO OK — @repo/email funciona end-to-end via Mailhog')
console.log('[smoke] Inbox UI: http://localhost:8025')
