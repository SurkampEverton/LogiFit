#!/usr/bin/env node
/**
 * compliance-check (T19 ADR 0090) — valida 4 invariantes de compliance:
 *
 *   1. Cada RIPD em docs/compliance/ripd/v*.md tem `Status:` válido.
 *      Se Status=Vigente: o `Hash SHA-256:` no frontmatter bate com o conteúdo.
 *   2. Cada sprint em `doing` tem ADR esperado publicado (cruzamento via docs-check).
 *      [stub Sprint 00 — só Sprint 01a+ tem ADR esperado]
 *   3. Cada feature crítica em docs/threat-models/*.md tem 6 categorias STRIDE.
 *      [stub Sprint 00 — valida só template + presença]
 *   4. Schema Drizzle ai_audit_log tem colunas obrigatórias (regra 28).
 *      [stub Sprint 00 — schema chega Sprint 06]
 *
 * Falha (exit 1) na primeira divergência. Sai 0 com sumário.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const RIPD_DIR = join(ROOT, 'docs', 'compliance', 'ripd')
const THREAT_DIR = join(ROOT, 'docs', 'threat-models')

const errors = []
const warnings = []

function ripdHash(content) {
  const stripped = content.replace(/^Hash SHA-256:.*$/m, 'Hash SHA-256:')
  return createHash('sha256').update(stripped).digest('hex')
}

function checkRipd() {
  let files
  try {
    files = readdirSync(RIPD_DIR).filter((f) => /^v\d/.test(f) && f.endsWith('.md'))
  } catch {
    warnings.push(`compliance: diretório ${RIPD_DIR} ausente — Sprint 00 esperado`)
    return
  }
  let checked = 0
  let legacy = 0
  for (const file of files) {
    const path = join(RIPD_DIR, file)
    const content = readFileSync(path, 'utf8')
    const statusMatch = content.match(/^Status:\s*(\S+)/m)
    if (!statusMatch) {
      // Formato legacy (RIPDs criados antes de Sprint 00 Faixa 4) — sprint dono
      // do módulo migra pra Status: Vigente/TODO quando o módulo entrar em doing.
      legacy++
      continue
    }
    const status = statusMatch[1]
    if (!['Vigente', 'TODO', 'Rascunho', 'Deprecated'].includes(status)) {
      errors.push(`✗ ${file}: Status inválido "${status}" (use Vigente/TODO/Rascunho/Deprecated)`)
      continue
    }
    if (status === 'Vigente') {
      const hashMatch = content.match(/^Hash SHA-256:\s*([a-f0-9]{64})/m)
      if (!hashMatch) {
        errors.push(`✗ ${file}: Status=Vigente exige "Hash SHA-256: <64-hex>"`)
        continue
      }
      const expected = ripdHash(content)
      if (hashMatch[1] !== expected) {
        errors.push(
          `✗ ${file}: Hash divergente. Esperado ${expected}, encontrado ${hashMatch[1]}. Rode "pnpm hash:ripd".`,
        )
      }
    }
    checked++
  }
  console.log(`  ripd: ${checked} validados (Status formal) + ${legacy} legacy (Sprint dono migra)`)
}

function checkThreatModels() {
  let files
  try {
    files = readdirSync(THREAT_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  } catch {
    warnings.push(`compliance: diretório ${THREAT_DIR} ausente`)
    return
  }
  const STRIDE = ['Spoofing', 'Tampering', 'Repudiation', 'Information Disclosure', 'Denial of Service', 'Elevation of Privilege']
  let checked = 0
  for (const file of files) {
    const content = readFileSync(join(THREAT_DIR, file), 'utf8')
    const missing = STRIDE.filter((cat) => !new RegExp(`\\b${cat.replace(/ /g, '\\s+')}\\b`, 'i').test(content))
    if (missing.length > 0) {
      warnings.push(`⚠ ${file}: STRIDE incompleto, faltando ${missing.join(', ')}`)
    }
    checked++
  }
  console.log(`  threat-models: ${checked} arquivos validados`)
}

function checkAdrEsperado() {
  console.log('  adr-esperado: stub (Sprint 01a+ ativa via docs:check)')
}

function checkAiAuditLogSchema() {
  console.log('  ai_audit_log schema: stub (Sprint 06 ativa)')
}

console.log('compliance-check:')
checkRipd()
checkThreatModels()
checkAdrEsperado()
checkAiAuditLogSchema()

if (warnings.length > 0) {
  console.warn('\nWarnings:')
  for (const w of warnings) console.warn(`  ${w}`)
}

if (errors.length > 0) {
  console.error('\ncompliance-check FAIL:')
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}

console.log('\n✓ compliance-check OK')
