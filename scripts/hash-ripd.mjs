#!/usr/bin/env node
/**
 * hash-ripd — calcula SHA-256 do conteúdo de cada RIPD em docs/compliance/ripd/
 * (excluindo o próprio campo `Hash SHA-256:`) e atualiza o frontmatter.
 *
 * Uso:
 *   pnpm hash:ripd              — atualiza todos os RIPDs com Status=Vigente
 *   pnpm hash:ripd --check      — só imprime divergências (exit 1 se houver)
 *
 * Sprint 00: implementa para regra 29 (RIPD versionado + hash bate).
 * Cruzamento com compliance-check.mjs.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const RIPD_DIR = join(ROOT, 'docs', 'compliance', 'ripd')
const checkOnly = process.argv.includes('--check')

function ripdHash(content) {
  const stripped = content.replace(/^Hash SHA-256:.*$/m, 'Hash SHA-256:')
  return createHash('sha256').update(stripped).digest('hex')
}

let files
try {
  files = readdirSync(RIPD_DIR).filter((f) => /^v\d/.test(f) && f.endsWith('.md'))
} catch (err) {
  console.error(`hash-ripd: ${RIPD_DIR} não existe`, err)
  process.exit(1)
}

let updated = 0
let divergent = 0

for (const file of files) {
  const path = join(RIPD_DIR, file)
  const content = readFileSync(path, 'utf8')
  const statusMatch = content.match(/^Status:\s*(\S+)/m)
  if (!statusMatch || statusMatch[1] !== 'Vigente') continue

  const expected = ripdHash(content)
  const hashMatch = content.match(/^Hash SHA-256:\s*([a-f0-9]{64})?/m)

  if (!hashMatch) {
    if (checkOnly) {
      console.error(`✗ ${file}: faltando linha "Hash SHA-256:"`)
      divergent++
    } else {
      console.error(`✗ ${file}: faltando linha "Hash SHA-256:" (adicione manualmente no frontmatter)`)
    }
    continue
  }

  const current = hashMatch[1] ?? ''
  if (current === expected) continue

  if (checkOnly) {
    console.error(`✗ ${file}: hash divergente (esperado ${expected.slice(0, 12)}…, atual ${current.slice(0, 12) || '∅'}…)`)
    divergent++
  } else {
    const updatedContent = content.replace(
      /^Hash SHA-256:.*$/m,
      `Hash SHA-256: ${expected}`,
    )
    writeFileSync(path, updatedContent, 'utf8')
    console.log(`✓ ${file}: ${expected.slice(0, 16)}…`)
    updated++
  }
}

if (checkOnly && divergent > 0) {
  console.error(`\nhash-ripd --check FAIL: ${divergent} divergências`)
  process.exit(1)
}
console.log(`\nhash-ripd: ${updated} atualizado(s), ${files.length} arquivos analisados`)
