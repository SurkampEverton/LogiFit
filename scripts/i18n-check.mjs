#!/usr/bin/env node
/**
 * i18n-check — valida regra 27 (ADR 0052):
 *   1. Paridade: cada chave existe em todos os locales (LOCALES).
 *   2. Cobertura de uso: cada chave usada via t('...') no código existe em pt-BR (default).
 *
 * Falha (exit 1) na primeira divergência. Sai 0 com sumário se tudo OK.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { extractKeys } from './i18n-extract.mjs'

const ROOT = process.cwd()
const MESSAGES_DIR = join(ROOT, 'apps/web/src/messages')
const LOCALES = ['pt-BR', 'en-US', 'es-419']
const DEFAULT_LOCALE = 'pt-BR'

function loadMessages(locale, ns) {
  const path = join(MESSAGES_DIR, locale, `${ns}.json`)
  try {
    statSync(path)
  } catch {
    return null
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function flatten(obj, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(obj ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, p))
    else out.push(p)
  }
  return out
}

function lookup(obj, dottedKey) {
  let cur = obj
  for (const part of dottedKey.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

function listNamespaces() {
  const namespaces = new Set()
  for (const locale of LOCALES) {
    let files
    try {
      files = readdirSync(join(MESSAGES_DIR, locale))
    } catch {
      continue
    }
    for (const f of files) {
      if (f.endsWith('.json')) namespaces.add(f.replace(/\.json$/, ''))
    }
  }
  return [...namespaces].sort()
}

function main() {
  const errors = []
  const namespaces = listNamespaces()

  if (namespaces.length === 0) {
    console.error(`✗ i18n-check: nenhum namespace encontrado em ${MESSAGES_DIR}`)
    process.exit(1)
  }

  for (const ns of namespaces) {
    const keysByLocale = {}
    for (const locale of LOCALES) {
      const m = loadMessages(locale, ns)
      if (!m) {
        errors.push(`✗ missing file: ${locale}/${ns}.json`)
        keysByLocale[locale] = new Set()
        continue
      }
      keysByLocale[locale] = new Set(flatten(m))
    }
    const union = new Set()
    for (const set of Object.values(keysByLocale)) for (const k of set) union.add(k)
    for (const locale of LOCALES) {
      for (const k of union) {
        if (!keysByLocale[locale].has(k)) {
          errors.push(`✗ ${ns}.${k} missing in ${locale}`)
        }
      }
    }
  }

  const usages = extractKeys()
  const defaultMessages = {}
  for (const ns of namespaces) defaultMessages[ns] = loadMessages(DEFAULT_LOCALE, ns)

  for (const u of usages) {
    if (!defaultMessages[u.namespace]) {
      errors.push(
        `✗ ${u.file}: namespace "${u.namespace}" usado em t() mas sem catálogo em ${DEFAULT_LOCALE}/`,
      )
      continue
    }
    if (lookup(defaultMessages[u.namespace], u.key) === undefined) {
      errors.push(
        `✗ ${u.file}: chave "${u.namespace}.${u.key}" usada em t() mas ausente em ${DEFAULT_LOCALE}/${u.namespace}.json`,
      )
    }
  }

  if (errors.length > 0) {
    console.error('i18n-check FAIL:')
    for (const e of errors) console.error(`  ${e}`)
    process.exit(1)
  }

  const totalKeys = namespaces.reduce((acc, ns) => {
    const m = loadMessages(DEFAULT_LOCALE, ns)
    return acc + (m ? flatten(m).length : 0)
  }, 0)
  console.log(
    `✓ i18n-check: ${totalKeys} keys × ${LOCALES.length} locales · ${usages.length} usages no código (${namespaces.length} namespaces)`,
  )
}

main()
