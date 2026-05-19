#!/usr/bin/env node
/**
 * lint-custom — checkers transversais que Biome ainda não suporta como
 * plugin. JS puro (sem deps), regex-based. Faixa 4 do Sprint 00.
 *
 * Checkers ativos (9):
 *   1. no-window-alert            — regra 45 (catálogo de mensagens fechado)
 *   2. no-raw-fetch               — regra 37 (safeFetch obrigatório)
 *   3. no-hardcoded-design-token  — regra 44 (tokens EV via var(--ev-*))
 *   4. no-rejected-saas-import    — regra 46 (SDKs rejeitados pelo ADR 0091)
 *   5. no-hardcoded-toast-message — regra 45 + 27 (toast deve vir de t('...'))
 *   6. no-unwrapped-action        — regra 33 (Server Action sem wrapAction)
 *   7. high-risk-action-must-require-recent-mfa — regra 43 (MFA <15min em high-risk)
 *   8. cross-tenant-read-must-log — regra 42 (leitura cross-tenant grava audit)
 *   9. ai-block-respected         — regra 41 + ADR 0075 (registerAITool não pode apontar pra handler com `// ai-blocked`)
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

/**
 * Detecta exempção em comentário inline OU na linha imediatamente acima.
 * Padrão canônico LogiFit pra suppressions — duas formas válidas:
 *
 *   1. inline (linha curta):
 *      foo() // safe-fetch-exempt: motivo
 *
 *   2. linha acima (legibilidade):
 *      // safe-fetch-exempt: motivo
 *      foo()
 */
function hasExemption(lines, idx, tag) {
  const current = lines[idx] ?? ''
  if (current.includes(tag)) return true
  const above = lines[idx - 1] ?? ''
  const aboveTrimmed = above.trim()
  if (
    (aboveTrimmed.startsWith('//') || aboveTrimmed.startsWith('*')) &&
    above.includes(tag)
  ) {
    return true
  }
  return false
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
    if (hasExemption(lines, i, '// alert-exempt:')) continue
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
    if (hasExemption(lines, i, '// safe-fetch-exempt:')) continue
    report('no-raw-fetch', file, i + 1, line)
  }
}

// ───────────────────────────────────────────────────────────
// 3. no-hardcoded-design-token (regra 44)
//
// Regra: proibido hardcode de hex em CSS/JSX style.
// Exceção: hex dentro de `var(--ev-*, #fallback)` é fallback CSS válido
//   (padrão pra browsers/snapshots sem custom property carregada).
//
// Contextos isentos (não são tokens UI — são dados ou bypass técnico):
//   - Arquivos `tokens.css` / `globals.css` (definem os próprios tokens)
//   - Arquivos `seed-*.ts` / `seed*.ts` (cores de dado por tenant, não tema)
//   - Arquivos `*.test.ts` / `*.test.tsx` (fixtures)
//   - Pasta `**/pdf/**` (PDF renderer não suporta CSS custom properties)
//   - Arquivos `manifest.webmanifest*` (PWA manifest JSON, não CSS)
//   - Linhas com `.default('#...')` (Drizzle/Zod default em schema/validator)
//   - Linhas com `themeColor` / `theme_color` / `background_color` (Next.js
//     viewport + PWA manifest — lidos antes do CSS carregar)
// ───────────────────────────────────────────────────────────
const RE_HEX = /#[0-9A-Fa-f]{3,8}\b/g
const RE_VAR_FALLBACK_HEX = /var\(\s*--[\w-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)/g
const TOKENS_FILE = /packages[\\/]ui[\\/]src[\\/]tokens\.css$/
const APP_GLOBALS = /apps[\\/]web[\\/]app[\\/]globals\.css$/
const SEED_FILE = /[\\/]seed[a-zA-Z0-9_-]*\.ts$/
const PDF_PATH = /[\\/]pdf[\\/]/
const MANIFEST_PATH = /manifest\.webmanifest/
const RE_DEFAULT_CALL = /\.default\(\s*['"]#[0-9A-Fa-f]{3,8}['"]/
const RE_THEME_COLOR_KEYS = /\b(themeColor|theme_color|background_color)\s*:\s*['"]#/
function checkNoHardcodedDesignToken(file, lines) {
  if (TOKENS_FILE.test(file)) return
  if (APP_GLOBALS.test(file)) return
  if (SEED_FILE.test(file)) return
  if (PDF_PATH.test(file)) return
  if (MANIFEST_PATH.test(file)) return
  if (file.includes('.test.')) return
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue
    if (hasExemption(lines, i, '// design-token-exempt:')) continue
    // Conta hex total - hex dentro de var() fallback. Se sobra hex "solto", dispara.
    const totalHex = (line.match(RE_HEX) ?? []).length
    if (totalHex === 0) continue
    const inVarFallback = (line.match(RE_VAR_FALLBACK_HEX) ?? []).length
    if (totalHex <= inVarFallback) continue
    // Drizzle/Zod default('#XXX') — cor é dado, não tema
    if (RE_DEFAULT_CALL.test(line)) continue
    // Next.js viewport themeColor / PWA manifest theme_color/background_color
    if (RE_THEME_COLOR_KEYS.test(line)) continue
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
    if (hasExemption(lines, i, '// toast-exempt:')) continue
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
/**
 * Aceita 3 wrappers canônicos:
 *   - `wrapAction(` — base agnóstica (jobs/CLI sem session) ADR 0071
 *   - `wrapServerAction(` — staff (apps/web/app/lib/wrap-action.ts) ADR 0071
 *   - `wrapMemberAction(` — portal do paciente (apps/web/app/lib/wrap-member-action.ts) Sprint 02c2 ADR 0088
 */
const RE_WRAP_ACTION = /\bwrap(?:Server|Member)?Action\s*\(/
const RE_REQUIRE_MEMBER_SESSION = /\brequireMemberSession\s*\(/
const RE_WITH_MEMBER_CONTEXT = /\bwithMemberContext\s*\(/
const ACTION_FILE_PATTERN = /\.(action|server)\.ts$/
function checkNoUnwrappedAction(file, lines) {
  if (file.includes('.test.')) return
  if (file.includes('e2e')) return
  const content = lines.join('\n')
  const isServerAction = RE_USE_SERVER.test(content) || ACTION_FILE_PATTERN.test(file)
  if (!isServerAction) return
  // Padrões aceitos (heurística por arquivo — refinar pra função-nível Sprint 02d+):
  //   1. `wrapAction(` / `wrapServerAction(` — padrão staff (ADR 0071)
  //   2. `requireMemberSession(` + `withMemberContext(` — padrão member portal
  //      Sprint 26 (ADR 0088 magic link). Session/context é diferente do staff
  //      flow — `wrapServerAction` assume `requireFullSession` (JWT staff claims)
  //      que não cabe no portal do paciente.
  const hasWrap = RE_WRAP_ACTION.test(content)
  const hasMemberAuth =
    RE_REQUIRE_MEMBER_SESSION.test(content) && RE_WITH_MEMBER_CONTEXT.test(content)
  if (hasWrap || hasMemberAuth) return
  // Detecta exports async não-wrapadas
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isCommentLine(line)) continue
    if (!RE_EXPORTED_ASYNC.test(line)) continue
    if (hasExemption(lines, i, '// ai-blocked:')) continue
    if (hasExemption(lines, i, '// wrap-exempt:')) continue
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
    // Encontrou definição. Deve haver gate de MFA, aceito em 3 padrões:
    //   1. `requireRecentMfa(...)` direto no handler
    //   2. `requireRecentMfaForAction(...)` direto no handler
    //   3. `wrapServerAction({action: 'X', ...}, ...)` onde X é high-risk —
    //      lib/wrap-action.ts chama requireRecentMfaForAction automaticamente
    //      via lookup em HIGH_RISK_ACTIONS, então não exige call manual.
    if (content.includes('requireRecentMfa(')) continue
    if (content.includes('requireRecentMfaForAction(')) continue
    const wrapRe = new RegExp(
      `wrap(?:Server)?Action\\s*\\(\\s*\\{[^}]*action\\s*:\\s*['"]${action}['"]`,
    )
    if (wrapRe.test(content)) continue
    if (content.includes('// mfa-exempt:')) continue
    const lineNum = content.slice(0, content.indexOf(match[0])).split(/\r?\n/).length
    report('high-risk-action-must-require-recent-mfa', file, lineNum, match[0])
  }
}

// ───────────────────────────────────────────────────────────
// 8. cross-tenant-read-must-log (regra 42 + ADR 0077 — LGPD art. 11)
//
// Sprint 02 fechamento materializou o padrão real:
//   - Função SQL `has_cross_tenant_access(reader_user, reader_tenant, passport,
//     module, category)` em `packages/db/src/policies/0055_has_cross_tenant_access.sql`
//     decide se leitura é permitida (gate fail-closed).
//   - Tabela `patient_data_access_log` recebe audit forense de toda leitura
//     que passou pelo gate (LGPD art. 11 — direito do titular saber quem
//     leu seus dados).
//
// **Regra**: o par gate + audit DEVE andar junto. Detecta 2 violações:
//   - Arquivo chama `has_cross_tenant_access(` mas NÃO grava `patient_data_access_log`
//     → audit ausente (não dá pra provar o que foi lido)
//   - Arquivo INSERT em `patient_data_access_log` mas NÃO chama `has_cross_tenant_access(`
//     → log sem permissão checada (falsifica audit dizendo "lê permitido")
//
// Exempção: `// cross-tenant-log-exempt: <motivo>` no arquivo (raro — só
//   pra jobs background que rodam read+log em arquivos separados).
//
// Ignora: tests, e2e, schema declarations, migrations, policies SQL (definem
//   mas não chamam), high-risk-actions.ts (catalog).
// ───────────────────────────────────────────────────────────
const RE_HAS_CROSS_TENANT_ACCESS = /\bhas_cross_tenant_access\s*\(/
// Match Drizzle insert `db.insert(patientDataAccessLog)` OR raw SQL `INSERT INTO patient_data_access_log`
const RE_ACCESS_LOG_WRITE =
  /\b(?:patientDataAccessLog|INSERT\s+INTO\s+patient_data_access_log)\b/i
function checkCrossTenantReadMustLog(file, lines) {
  if (file.includes('.test.')) return
  if (file.includes('e2e')) return
  if (file.includes('schema')) return
  if (file.includes('policies')) return
  if (file.includes('migration')) return
  if (file.includes('high-risk-actions.ts')) return

  // Scan linha-a-linha, ignorando comments (pra não pegar menção em docstring)
  let callsGate = false
  let writesLog = false
  let firstGateLine = -1
  let firstLogLine = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isCommentLine(line)) continue
    if (RE_HAS_CROSS_TENANT_ACCESS.test(line)) {
      callsGate = true
      if (firstGateLine === -1) firstGateLine = i
    }
    if (RE_ACCESS_LOG_WRITE.test(line)) {
      writesLog = true
      if (firstLogLine === -1) firstLogLine = i
    }
  }

  if (!callsGate && !writesLog) return
  if (callsGate && writesLog) return // par completo OK

  // Exempção (procura na linha imediatamente acima da gate/log call ou em comment file-level)
  const exemptAnchor = firstGateLine >= 0 ? firstGateLine : firstLogLine
  if (hasExemption(lines, exemptAnchor, '// cross-tenant-log-exempt:')) return

  if (callsGate && !writesLog) {
    report(
      'cross-tenant-read-must-log',
      file,
      firstGateLine + 1,
      `${lines[firstGateLine]}  (gate has_cross_tenant_access sem INSERT em patient_data_access_log)`,
    )
  } else if (writesLog && !callsGate) {
    report(
      'cross-tenant-read-must-log',
      file,
      firstLogLine + 1,
      `${lines[firstLogLine]}  (INSERT em patient_data_access_log sem chamar has_cross_tenant_access)`,
    )
  }
}

// ───────────────────────────────────────────────────────────
// 9. ai-block-respected (regra 41 + ADR 0075)
//    Garante que tools com `// ai-blocked:` no handler real não sejam
//    chamadas via `registerAITool({ handler })` SEM `blocked: { reason }`.
//
//    Detecta duas violações:
//      (a) handler tem comentário `// ai-blocked:` mas registro não declara blocked → FAIL
//      (b) registro tem `blocked: { reason }` mas handler real não tem `// ai-blocked:` → WARN (sinaliza desalinhamento)
//
//    Heurística: scan global por todos os `registerAITool({ key: '<X>'...})` e
//    se a string `// ai-blocked` aparecer no codebase em qualquer arquivo dentro
//    do mesmo módulo (ex: `agenda/`), exige `blocked: { reason: ` na registry call.
//
//    Sprint 06 MVP: enforça apenas tools registradas com `blocked: { reason }`
//    ou que NÃO têm `handler:` no registry — o handler real fica fora do
//    registry. Se alguém adicionar `handler` apontando pra Server Action com
//    `// ai-blocked` no topo, esse checker pega.
// ───────────────────────────────────────────────────────────
const RE_AI_BLOCK_COMMENT = /\/\/\s*ai-blocked:/
const RE_REGISTER_AI_TOOL_BLOCK = /registerAITool\s*\(\s*\{[\s\S]*?\}\s*\)/g
const RE_BLOCKED_FIELD = /\bblocked:\s*\{\s*reason:/
function checkAiBlockRespected(file, lines) {
  if (file.includes('.test.')) return
  const content = lines.join('\n')
  const hasAiBlock = RE_AI_BLOCK_COMMENT.test(content)
  const callMatches = content.match(RE_REGISTER_AI_TOOL_BLOCK)
  if (!callMatches) return

  for (const call of callMatches) {
    // Se a chamada NÃO declara `blocked:` mas referencia um handler que tem
    // `// ai-blocked:` no mesmo arquivo, é violação.
    if (!RE_BLOCKED_FIELD.test(call)) {
      // Procura `handler: <name>` na call e verifica se `<name>` tem ai-blocked
      const handlerMatch = call.match(/handler:\s*([A-Za-z_][\w]*)/)
      if (handlerMatch && hasAiBlock) {
        const handlerName = handlerMatch[1]
        const handlerDecl = new RegExp(
          `(export\\s+)?(const|function|async function)\\s+${handlerName}\\b[\\s\\S]{0,200}//\\s*ai-blocked:`,
        )
        if (handlerDecl.test(content)) {
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]?.includes(`handler: ${handlerName}`)) {
              report('ai-block-respected', file, i + 1, lines[i] ?? '')
              break
            }
          }
        }
      }
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
  checkAiBlockRespected(file, lines)
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
  `✓ lint-custom: ${codeFiles.length} code + ${cssFiles.length} css files clean (9 rules)`,
)
