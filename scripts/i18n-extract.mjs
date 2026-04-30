#!/usr/bin/env node
/**
 * i18n-extract — varre apps/web procurando chaves de i18n usadas via:
 *   - useTranslations('namespace') / getTranslations('namespace')  → declara namespace ativo
 *   - t('key.dotted')                                              → chave usada
 *
 * Atribui cada t('...') ao último namespace declarado antes (heurística boa
 * para o padrão "1 useTranslations por arquivo"). Caso edge (múltiplos
 * namespaces no mesmo arquivo) é resolvido pela posição textual.
 *
 * Importado por scripts/i18n-check.mjs. Também executável standalone para listar uso.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const SCAN_DIRS = ['apps/web']
const EXTS = new Set(['.ts', '.tsx'])
const IGNORE = new Set(['node_modules', '.next', 'dist', '.turbo', 'coverage', 'build', 'out'])

function walk(dir) {
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
    if (entry.isDirectory()) files.push(...walk(path))
    else if (EXTS.has(extname(entry.name))) files.push(path)
  }
  return files
}

const RE_USE_T = /(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]\s*\)/g
const RE_T = /(?<![\w.])t\(\s*['"]([^'"]+)['"]/g

export function extractKeys() {
  const usages = []
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))
  for (const file of files) {
    const content = readFileSync(file, 'utf8')

    const nsRanges = []
    for (const match of content.matchAll(RE_USE_T)) {
      nsRanges.push({ ns: match[1], pos: match.index ?? 0 })
    }

    for (const match of content.matchAll(RE_T)) {
      const pos = match.index ?? 0
      let ns = null
      for (const range of nsRanges) {
        if (range.pos <= pos) ns = range.ns
        else break
      }
      if (!ns) continue
      usages.push({ file, namespace: ns, key: match[1] })
    }
  }
  return usages
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const usages = extractKeys()
  const byNs = {}
  for (const u of usages) {
    byNs[u.namespace] ??= new Set()
    byNs[u.namespace].add(u.key)
  }
  for (const [ns, keys] of Object.entries(byNs).sort()) {
    console.log(`\n[${ns}]`)
    for (const k of [...keys].sort()) console.log(`  ${k}`)
  }
  console.log(
    `\n${usages.length} usages across ${Object.keys(byNs).length} namespaces, ${new Set(usages.map((u) => u.file)).size} files`,
  )
}
