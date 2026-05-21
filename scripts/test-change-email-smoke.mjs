#!/usr/bin/env node
/**
 * Smoke test do change_email flow (Sprint 02b5).
 *
 * Valida cadeia completa via docker exec psql + fetch:
 *   1. Cria identity passport via psql bypass RLS
 *   2. INSERT direto de um token kind='change_email'
 *   3. Chama route handler /api/meu/perfil/email/confirm-change?t=<token>
 *   4. Verifica que identity.email mudou + email_verified_at setado
 *   5. Verifica notificação no Mailhog pro email ANTIGO
 *
 * Sem deps externas (psql via docker exec, fetch nativo).
 *
 * Pré-requisitos:
 *   - docker compose up -d (Postgres + Mailhog)
 *   - pnpm dev rodando em localhost:3100
 */

import { spawnSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'

function psql(sql) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', 'logifit-postgres', 'psql', '-U', 'postgres', '-d', 'logifit', '-t', '-A', '-F', '|', '-c', sql],
    { encoding: 'utf-8' },
  )
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

const OLD_EMAIL = `change-old-${Date.now()}@logifit.test`
const NEW_EMAIL = `change-new-${Date.now()}@logifit.test`

console.log('[smoke] OLD_EMAIL:', OLD_EMAIL)
console.log('[smoke] NEW_EMAIL:', NEW_EMAIL)

// 1. Cleanup + cria identity
psql(`DELETE FROM passport_global_identities WHERE email LIKE 'change-old-%@logifit.test' OR email LIKE 'change-new-%@logifit.test';`)
const ts = Date.now().toString().slice(-9)
const cpf = `${ts}99`

// SET + INSERT em statements separados; RETURNING id em statement isolado
psql(`SET row_security = off; INSERT INTO passport_global_identities (
  name, cpf_normalized, email, phone, phone_verified_at,
  password_hash, accepted_terms_at, terms_version,
  accepted_privacy_at, privacy_version, ripd_version_signup,
  signup_path
) VALUES (
  'Test Change Email', '${cpf}', '${OLD_EMAIL}', '11888888888', now(),
  'placeholder-hash', now(), 'v1.0',
  now(), 'v1.0', 'v1.0-test',
  'proactive'
);`)
const identityId = psql(`SET row_security = off; SELECT id FROM passport_global_identities WHERE email = '${OLD_EMAIL}';`)
  .split('\n')
  .filter((line) => line.match(/^[0-9a-f-]{36}$/))
  .pop()
if (!identityId) {
  console.error('[smoke] FALHA — identity_id não extraído. Output:', psql(`SELECT id FROM passport_global_identities WHERE email = '${OLD_EMAIL}';`))
  process.exit(1)
}
console.log('[smoke] identity criada:', identityId)

// 2. Gera token + grava
const tokenBytes = randomBytes(32)
const token = tokenBytes.toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')

psql(`
SET row_security = off;
INSERT INTO passport_email_verification_tokens
  (passport_global_identity_id, email, kind, new_email, token_hash, expires_at)
VALUES ('${identityId}', '${OLD_EMAIL}', 'change_email', '${NEW_EMAIL}', '${tokenHash}', now() + interval '24 hours');
`)
console.log('[smoke] token change_email inserido')

// 3. Limpa Mailhog + chama route handler
await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' })

const confirmUrl = `http://localhost:3100/api/meu/perfil/email/confirm-change?t=${token}`
console.log('[smoke] GET', confirmUrl.replace(token, token.slice(0, 8) + '...'))

const res = await fetch(confirmUrl, { redirect: 'manual' })
console.log('[smoke] status:', res.status, 'location:', res.headers.get('location'))

if (res.status !== 307 && res.status !== 308) {
  console.error('[smoke] FALHA — esperado redirect, got', res.status)
  process.exit(1)
}
const location = res.headers.get('location') ?? ''
if (!location.includes('email-trocado')) {
  console.error('[smoke] FALHA — redirect esperado pra email-trocado, got:', location)
  process.exit(1)
}

// 4. Verifica DB: identity.email mudou
const after = psql(`SET row_security = off; SELECT email, email_verified_at FROM passport_global_identities WHERE id = '${identityId}';`)
console.log('[smoke] identity após confirm:', after)
const [updatedEmail, verifiedAt] = after.split('\n').filter(Boolean).pop().split('|')

if (updatedEmail.trim() !== NEW_EMAIL) {
  console.error(`[smoke] FALHA — email não atualizou: '${updatedEmail}' (esperado '${NEW_EMAIL}')`)
  process.exit(1)
}
if (!verifiedAt || verifiedAt.trim() === '') {
  console.error('[smoke] FALHA — email_verified_at não foi setado')
  process.exit(1)
}

// 5. Aguarda + verifica notificação Mailhog pro OLD email
await new Promise((r) => setTimeout(r, 700))
const inbox = await (await fetch('http://localhost:8025/api/v2/messages?limit=10')).json()
const oldNotif = (inbox.items ?? []).find((m) =>
  (m.Content?.Headers?.To?.[0] ?? '').toLowerCase().includes(OLD_EMAIL.toLowerCase()),
)
if (!oldNotif) {
  console.error('[smoke] FALHA — notificação NÃO chegou no email ANTIGO')
  console.error('[smoke] inbox To addresses:', (inbox.items ?? []).map((m) => m.Content?.Headers?.To?.[0]))
  process.exit(1)
}
console.log('[smoke] ✓ notificação chegou no email antigo')
console.log('  Subject:', oldNotif.Content?.Headers?.Subject?.[0])

// 6. Cleanup
psql(`SET row_security = off; DELETE FROM passport_email_verification_tokens WHERE passport_global_identity_id = '${identityId}'; DELETE FROM passport_global_identities WHERE id = '${identityId}';`)

console.log('')
console.log('[smoke] ✅ TUDO OK — change_email flow funciona end-to-end:')
console.log('  ✓ token kind=change_email gravado')
console.log('  ✓ route handler /api/meu/perfil/email/confirm-change confirma + redireciona')
console.log('  ✓ identity.email atualizou pra NEW_EMAIL')
console.log('  ✓ email_verified_at setado')
console.log('  ✓ notificação chegou no email ANTIGO (alerta segurança)')
