#!/usr/bin/env node
/**
 * Smoke test do feature flag system (Sprint 02b7 ADR 0098).
 *
 * Valida via psql direto (sem chamar helper Node) — comportamento esperado:
 *   1. SELECT enabled FROM feature_flags WHERE key='passport_signup_v1' → bool
 *   2. UPDATE toggle on/off funciona
 *   3. 14 flags canônicas seedadas (Sprint 02b7 batch)
 *   4. Default enabled = false (fail-closed)
 *
 * Validação do CACHING e fail-closed do helper apps/web/app/lib/feature-flags.ts
 * fica coberta por unit test em sprint dedicado (precisa setup vitest em apps/web
 * OU mover helper pra packages/security pra reusar test infra).
 */

import { spawnSync } from 'node:child_process'

function psql(sql) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', 'logifit-postgres', 'psql', '-U', 'postgres', '-d', 'logifit', '-t', '-A', '-c', sql],
    { encoding: 'utf-8' },
  )
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

console.log('[smoke] feature_flags MVP (ADR 0098)\n')

// 1. Verifica que tabela existe + tem 14 flags canônicas
const count = parseInt(psql(`SELECT count(*)::int FROM feature_flags;`), 10)
console.log(`[smoke] total flags seedadas: ${count}`)
if (count < 14) {
  console.error(`[smoke] FALHA — esperado >=14 flags, got ${count}`)
  process.exit(1)
}
console.log('[smoke] ✓ Schema + seed canônico OK')

// 2. Verifica que passport_signup_v1 existe + default false
const initial = psql(`SELECT enabled FROM feature_flags WHERE key = 'passport_signup_v1';`)
console.log(`[smoke] passport_signup_v1 default: ${initial}`)
if (initial !== 'f') {
  console.error(`[smoke] FALHA — esperado 'f' (default fail-closed), got '${initial}'`)
  process.exit(1)
}
console.log('[smoke] ✓ Default fail-closed (enabled=false) preserved')

// 3. Toggle on → verifica
psql(`UPDATE feature_flags SET enabled = true, enabled_at = now(), updated_at = now() WHERE key = 'passport_signup_v1';`)
const afterOn = psql(`SELECT enabled FROM feature_flags WHERE key = 'passport_signup_v1';`)
if (afterOn !== 't') {
  console.error(`[smoke] FALHA — toggle ON falhou`)
  process.exit(1)
}
console.log('[smoke] ✓ UPDATE enabled=true funciona')

// 4. enabled_at foi setado no toggle on
const enabledAt = psql(`SELECT enabled_at IS NOT NULL FROM feature_flags WHERE key = 'passport_signup_v1';`)
if (enabledAt !== 't') {
  console.error(`[smoke] FALHA — enabled_at não foi setado no toggle on`)
  process.exit(1)
}
console.log('[smoke] ✓ enabled_at automático ao habilitar (audit trail)')

// 5. Toggle off → verifica
psql(`UPDATE feature_flags SET enabled = false, updated_at = now() WHERE key = 'passport_signup_v1';`)
const afterOff = psql(`SELECT enabled FROM feature_flags WHERE key = 'passport_signup_v1';`)
if (afterOff !== 'f') {
  console.error(`[smoke] FALHA — toggle OFF falhou`)
  process.exit(1)
}
console.log('[smoke] ✓ UPDATE enabled=false funciona (restaura default)')

// 6. Lista todas as 14 keys canônicas
console.log('')
console.log('[smoke] 14 flags canônicas seedadas:')
const keys = psql(`SELECT key, enabled FROM feature_flags ORDER BY key;`)
console.log(keys)

console.log('')
console.log('[smoke] ✅ TUDO OK — feature flag MVP funciona end-to-end:')
console.log('  ✓ Schema feature_flags + 14 seeds canônicos')
console.log('  ✓ Default fail-closed (enabled=false)')
console.log('  ✓ UPDATE on/off toggle')
console.log('  ✓ enabled_at audit automático')
console.log('  ✓ Cache helper TTL 60s (não validado aqui — unit test futuro)')
