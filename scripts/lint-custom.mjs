#!/usr/bin/env node
/**
 * lint-custom — checkers transversais que Biome ainda não suporta como
 * plugin. JS puro (sem deps), regex-based. Faixa 4 do Sprint 00.
 *
 * Checkers ativos (5):
 *   1. no-window-alert            — regra 45 (catálogo de mensagens fechado)
 *   2. no-raw-fetch               — regra 37 (safeFetch obrigatório)
 *   3. no-hardcoded-design-token  — regra 44 (tokens EV via var(--ev-*))
 *   4. no-rejected-saas-import    — regra 46 (SDKs rejeitados pelo ADR 0091)
 *   5. no-hardcoded-toast-message — regra 45 + 27 (toast deve vir de t('...'))
 *
 * Checkers que esperam Sprint 01a/02 (não rodando ainda):
 *   - no-unwrapped-action          → quando Server Actions reais existirem
 *   - high-risk-action-must-...    → quando handlers de high-risk-actions existirem
 *   - cross-tenant-read-must-log   → quando regra 42 patient_data_access_log nascer
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

const codeFiles = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d), CODE_EXTS))
const cssFiles = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d), CSS_EXTS))

for (const file of codeFiles) {
  const lines = readLines(file)
  checkNoWindowAlert(file, lines)
  checkNoRawFetch(file, lines)
  checkNoHardcodedDesignToken(file, lines)
  checkNoRejectedSaasImport(file, lines)
  checkNoHardcodedToastMessage(file, lines)
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
  `✓ lint-custom: ${codeFiles.length} code + ${cssFiles.length} css files clean (5 rules)`,
)
