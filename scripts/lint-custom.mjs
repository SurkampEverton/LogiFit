#!/usr/bin/env node
/**
 * lint-custom — checkers transversais que Biome ainda não suporta como
 * plugin. JS puro (sem deps), regex-based. Faixa 4 do Sprint 00.
 *
 * Checkers ativos (8):
 *   1. no-window-alert            — regra 45 (catálogo de mensagens fechado)
 *   2. no-raw-fetch               — regra 37 (safeFetch obrigatório)
 *   3. no-hardcoded-design-token  — regra 44 (tokens EV via var(--ev-*))
 *   4. no-rejected-saas-import    — regra 46 (SDKs rejeitados pelo ADR 0091)
 *   5. no-hardcoded-toast-message — regra 45 + 27 (toast deve vir de t('...'))
 *   6. no-unwrapped-action        — regra 33 (Server Action sem wrapAction)
 *   7. high-risk-action-must-require-recent-mfa — regra 43 (MFA <15min em high-risk)
 *   8. cross-tenant-read-must-log — regra 42 (leitura cross-tenant grava audit)
 *
 * Os checkers 6-8 são "ready" — passam silenciosamente até Sprint dono
 * criar o padrão (Server Actions, high-risk-actions.ts, patient_data_access_log).
 * Quando uma feature do Sprint 01a/02 introduzir o padrão, o lint começa a
 * enforçar automaticamente — zero refactor pós-fato.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['apps', 'packages']
const CODE_EXTS = new Set(['.ts', '.tsx'])
const CSS_EXTS = new Set(['.css'])
const IGNORE = new Set([
  'node_modules',
  '.next',
  'dist',
  '.turbo',
  'coverage',
  'build',
  'out',
  '.docker-data',
  'prototipo',
])

function walk(dir, exts) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(path, exts))
    else if (exts.has(extname(entry.name))) files.push(path)
  }
  return files
}

function readLines(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/)
}

function rel(file) {
  return relative(ROOT, file).replace(/\\/g, '/')
}

function isCommentLine(line) {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
}

const violations = []

function report(rule, file, line, snippet) {
  violations.push({ rule, file: rel(file), line, snippet: snippet.trim().slice(0, 120) })
}

// ───────────────────────────────────────────────────────────
// 1. no-window-alert (regra 45)
// ───────────────────────────────────────────────────────────
const RE_WINDOW_DIALOG = /\bwindow\.(alert|confirm|prompt)\s*\(/
function checkNoWindowAlert(file, lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isCommentLine(line)) continue
    if (!RE_WINDOW_DIALOG.test(line)) continue
    if (line.includes('// alert-exempt:')) continue
    report('no-window-alert', file, i + 1, line)
  }
}

// ───────────────────────────────────────────────────────────
// 2. no-raw-fetch (regra 37)
// ───────────────────────────────────────────────────────────
const RE_FETCH = /(?<![\w.])fetch\s*\(/
const SAFE_FETCH_FILE = /packages[\\/]security[\\/]src[\\/]safe-fetch\.ts$/
function checkNoRawFetch(file, lines) {
  if (SAFE_FETCH_FILE.test(file)) return
  if (file.includes('.test.')) return
  if (file.includes('e2e')) return
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isCommentLine(line)) continue
    if (!RE_FETCH.test(line)) continue
    if (line.includes('safeFetch')) continue
    if (line.includes('// safe-fetch-exempt:')) continue
    report('no-raw-fetch', file, i + 1, line)
  }
}

// ───────────────────────────────────────────────────────────
// 3. no-hardcoded-design-token (regra 44)
// ───────────────────────────────────────────────────────────
const RE_HEX = /#[0-9A-Fa-f]{3,8}\b/
const TOKENS_FILE = /packages[\\/]ui[\\/]src[\\/]tokens\.css$/
const APP_GLOBALS = /apps[\\/]web[\\/]app[\\/]globals\.css$/
function checkNoHardcodedDesignToken(file, lines) {
  if (TOKENS_FILE.test(file)) return
  if (APP_GLOBALS.test(file)) return
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue
    if (line.includes('// design-token-exempt:')) continue
    if (!RE_HEX.test(line)) continue
    report('no-hardcoded-design-token', file, i + 1, line)
  }
}

// ───────────────────────────────────────────────────────────
// 4. no-rejected-saas-import (regra 46 — SDKs rejeitados pelo ADR 0091)
// ───────────────────────────────────────────────────────────
const REJECTED_SDKS = [
  '@supabase/supabase-js',
  '@supabase/auth-helpers-nextjs',
  '@upstash/redis',
  '@upstash/ratelimit',
  '@vercel/postgres',
  '@vercel/kv',
  '@vercel/blob',
  'posthog-js',
  'posthog-node',
]
const RE_IMPORT = /(?:import|require)\s*(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/g
function checkNoRejectedSaasImport(file, lines) {
  const content = lines.join('\n')
  for (const match of content.matchAll(RE_IMPORT)) {
    const pkg = match[1]
    const root = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0]
    if (REJECTED_SDKS.includes(root)) {
      const lineNum = content.slice(0, match.index ?? 0).split(/\r?\n/).length
      report('no-rejected-saas-import', file, lineNum, match[0])
    }
  }
}

// ───────────────────────────────────────────────────────────
// 5. no-hardcoded-toast-message (regra 45 + 27)
// ───────────────────────────────────────────────────────────
const RE_TOAST_LITERAL =
  /\btoast\.(success|info|warning|error|critical|message|fromApiError)\s*\(\s*[`'"][^`'"]/
const TOAST_HELPERS_FILE = /packages[\\/]ui[\\/]src[\\/]messages[\\/]/
function checkNoHardcodedToastMessage(file, lines) {
  if (TOAST_HELPERS_FILE.test(file)) return
  if (file.includes('.test.')) return
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!RE_TOAST_LITERAL.test(line)) continue
    if (line.includes('// toast-exempt:')) continue
    report('no-hardcoded-toast-message', file, i + 1, line)
  }
}

// ───────────────────────────────────────────────────────────
// 6. no-unwrapped-action (regra 33)
//    Server Actions: arquivo com 'use server' OU `.action.ts`/`.server.ts`.
//    Exige que toda função exportada passe por `wrapAction(...)`.
//    Permite exceção via // ai-blocked: <motivo> (Server Action não exposta a IA).
// ───────────────────────────────────────────────────────────
const RE_USE_SERVER = /^\s*['"]use server['"]/m
const RE_EXPORTED_ASYNC = /^export\s+(?:async\s+function|const\s+\w+\s*=\s*async)/
const RE_WRAP_ACTION = /\bwrapAction\s*\(/
const ACTION_FILE_PATTERN = /\.(action|server)\.ts$/
function checkNoUnwrappedAction(file, lines) {
  if (file.includes('.test.')) return
  if (file.includes('e2e')) return
  const content = lines.join('\n')
  const isServerAction = RE_USE_SERVER.test(content) || ACTION_FILE_PATTERN.test(file)
  if (!isServerAction) return
  // Se arquivo todo está marcado ai-blocked + tem wrapAction em alguma linha, OK
  const hasWrap = RE_WRAP_ACTION.test(content)
  if (hasWrap) return // assume todas as funções estão wrapadas (lint é heurística — refinar Sprint 01a)
  // Detecta exports async não-wrapadas
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isCommentLine(line)) continue
    if (!RE_EXPORTED_ASYNC.test(line)) continue
    if (line.includes('// ai-blocked:')) continue
    if (line.includes('// wrap-exempt:')) continue
    report('no-unwrapped-action', file, i + 1, line)
  }
}

// ───────────────────────────────────────────────────────────
// 7. high-risk-action-must-require-recent-mfa (regra 43)
//    Detecta handlers cujo nome bate com lista em `packages/security/src/high-risk-actions.ts`.
//    Exige `requireRecentMfa()` no corpo da função (string match suficiente).
//    No-op até `high-risk-actions.ts` existir (Sprint 01a cria).
// ───────────────────────────────────────────────────────────
function loadHighRiskActions() {
  const path = join(ROOT, 'packages', 'security', 'src', 'high-risk-actions.ts')
  try {
    const content = readFileSync(path, 'utf8')
    // Captura strings em 'action: "..."' ou 'action: \'...\''
    const matches = [...content.matchAll(/action\s*:\s*['"]([a-zA-Z][a-zA-Z0-9]+)['"]/g)]
    return matches.map((m) => m[1])
  } catch {
    return [] // arquivo ainda não existe — lint silencioso
  }
}
const HIGH_RISK_ACTIONS = loadHighRiskActions()
function checkHighRiskActionMfa(file, lines) {
  if (HIGH_RISK_ACTIONS.length === 0) return
  if (file.includes('.test.')) return
  const content = lines.join('\n')
  for (const action of HIGH_RISK_ACTIONS) {
    const re = new RegExp(`\\b(?:function|const)\\s+${action}\\b`)
    const match = content.match(re)
    if (!match) continue
    // Encontrou definição da função; deve haver requireRecentMfa() no escopo
    if (content.includes('requireRecentMfa(')) continue
    if (content.includes('// mfa-exempt:')) continue
    const lineNum = content.slice(0, content.indexOf(match[0])).split(/\r?\n/).length
    report('high-risk-action-must-require-recent-mfa', file, lineNum, match[0])
  }
}

// ───────────────────────────────────────────────────────────
// 8. cross-tenant-read-must-log (regra 42)
//    Detecta queries que tocam dado cross-tenant — heurística:
//      - chamada a função `crossTenantQuery(...)`/`fetchFromOtherTenant(...)`/
//        `readCrossTenant(...)` OU
//      - SELECT/INSERT/UPDATE que referencia `origin_tenant_id` (coluna canônica
//        da tabela `patient_data_access_log`)
//    Exige `logCrossTenantAccess(...)` ou `auditCrossTenantRead(...)` no mesmo arquivo.
//    No-op até primeiro caller real (Sprint 01b — passport links).
// ───────────────────────────────────────────────────────────
const RE_CROSS_TENANT_QUERY =
  /\b(crossTenantQuery|fetchFromOtherTenant|readCrossTenant)\s*\(/
const RE_ORIGIN_TENANT_COL = /\borigin_tenant_id\b/
const RE_LOG_CROSS_TENANT = /\b(logCrossTenantAccess|auditCrossTenantRead)\s*\(/
function checkCrossTenantReadMustLog(file, lines) {
  if (file.includes('.test.')) return
  if (file.includes('e2e')) return
  if (file.includes('schema')) return // schema declarations are OK
  if (file.includes('migration')) return
  if (file.includes('high-risk-actions.ts')) return
  const content = lines.join('\n')
  const triggers = RE_CROSS_TENANT_QUERY.test(content) || RE_ORIGIN_TENANT_COL.test(content)
  if (!triggers) return
  if (RE_LOG_CROSS_TENANT.test(content)) return
  if (content.includes('// cross-tenant-log-exempt:')) return
  // Report first occurrence
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isCommentLine(line)) continue
    if (RE_CROSS_TENANT_QUERY.test(line) || RE_ORIGIN_TENANT_COL.test(line)) {
      report('cross-tenant-read-must-log', file, i + 1, line)
      return
    }
  }
}

// ───────────────────────────────────────────────────────────

const codeFiles = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d), CODE_EXTS))
const cssFiles = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d), CSS_EXTS))

for (const file of codeFiles) {
  const lines = readLines(file)
  checkNoWindowAlert(file, lines)
  checkNoRawFetch(file, lines)
  checkNoHardcodedDesignToken(file, lines)
  checkNoRejectedSaasImport(file, lines)
  checkNoHardcodedToastMessage(file, lines)
  checkNoUnwrappedAction(file, lines)
  checkHighRiskActionMfa(file, lines)
  checkCrossTenantReadMustLog(file, lines)
}

for (const file of cssFiles) {
  const lines = readLines(file)
  checkNoHardcodedDesignToken(file, lines)
}

if (violations.length > 0) {
  console.error(`✗ lint-custom FAIL: ${violations.length} violations\n`)
  const byRule = {}
  for (const v of violations) {
    byRule[v.rule] ??= []
    byRule[v.rule].push(v)
  }
  for (const [rule, list] of Object.entries(byRule).sort()) {
    console.error(`[${rule}] ${list.length}`)
    for (const v of list) {
      console.error(`  ${v.file}:${v.line}  ${v.snippet}`)
    }
    console.error('')
  }
  process.exit(1)
}

console.log(
  `✓ lint-custom: ${codeFiles.length} code + ${cssFiles.length} css files clean (8 rules)`,
)
