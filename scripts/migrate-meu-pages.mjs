#!/usr/bin/env node
/**
 * Migrate 19 /meu/* pages from requireMemberSession → requireMemberOrPassport.
 *
 * Sprint 02b6 — paciente passport sem vínculo clínico vê UI graceful
 * (<PassportNeedsLink>) em vez de redirecionar pra /meu/login.
 *
 * Uso: node scripts/migrate-meu-pages.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// path → { feature, depth (1=/meu/X, 2=/meu/X/Y), usesClaims, hideLinkButtons }
const PAGES = {
  // Tipo A — usam claims via withMemberContext; passport_needs_link → <PassportNeedsLink>
  'apps/web/app/meu/agenda/page.tsx':                      { feature: 'sua agenda',                  depth: 1, usesClaims: true,  hideLinkButtons: false },
  'apps/web/app/meu/agenda/novo/page.tsx':                 { feature: 'agendamento novo',            depth: 2, usesClaims: false, hideLinkButtons: false },
  'apps/web/app/meu/alertas/page.tsx':                     { feature: 'seus alertas',                depth: 1, usesClaims: true,  hideLinkButtons: false },
  'apps/web/app/meu/diario/page.tsx':                      { feature: 'seu diário alimentar',        depth: 1, usesClaims: true,  hideLinkButtons: false },
  'apps/web/app/meu/diario/novo/page.tsx':                 { feature: 'registrar refeição',          depth: 2, usesClaims: false, hideLinkButtons: false },
  'apps/web/app/meu/dispositivos/page.tsx':                { feature: 'seus dispositivos',           depth: 1, usesClaims: true,  hideLinkButtons: false },
  'apps/web/app/meu/dispositivos/historico/page.tsx':      { feature: 'histórico de leituras',       depth: 2, usesClaims: true,  hideLinkButtons: false },
  'apps/web/app/meu/dispositivos/importar/page.tsx':       { feature: 'importação de dispositivos',  depth: 2, usesClaims: false, hideLinkButtons: false },
  'apps/web/app/meu/exames/page.tsx':                      { feature: 'seus exames',                 depth: 1, usesClaims: true,  hideLinkButtons: false },
  'apps/web/app/meu/exames/upload/page.tsx':               { feature: 'upload de exames',            depth: 2, usesClaims: false, hideLinkButtons: false },
  'apps/web/app/meu/financeiro/page.tsx':                  { feature: 'suas faturas',                depth: 1, usesClaims: true,  hideLinkButtons: false },
  'apps/web/app/meu/privacidade/alertas-cruzados/page.tsx': { feature: 'alertas cruzados',          depth: 2, usesClaims: false, hideLinkButtons: false },
  'apps/web/app/meu/qr/page.tsx':                          { feature: 'seu QR code de acesso',       depth: 1, usesClaims: true,  hideLinkButtons: false },
  'apps/web/app/meu/recibos/page.tsx':                     { feature: 'seus recibos',                depth: 1, usesClaims: true,  hideLinkButtons: false },
  // Tipo B — privacy + convidar; hideLinkButtons=true evita loop pq elas SÃO os destinos dos botões
  'apps/web/app/meu/convidar/page.tsx':                    { feature: 'convidar empresa',            depth: 1, usesClaims: false, hideLinkButtons: true },
  'apps/web/app/meu/privacidade/page.tsx':                 { feature: 'sua privacidade',             depth: 1, usesClaims: true,  hideLinkButtons: true },
  'apps/web/app/meu/privacidade/acessos/page.tsx':         { feature: 'log de acessos',              depth: 2, usesClaims: true,  hideLinkButtons: true },
  'apps/web/app/meu/privacidade/compartilhamento/page.tsx': { feature: 'seus vínculos',            depth: 2, usesClaims: true,  hideLinkButtons: true },
  'apps/web/app/meu/privacidade/incidentes/page.tsx':      { feature: 'incidentes de segurança',     depth: 2, usesClaims: false, hideLinkButtons: true },
}

let migrated = 0
let skipped = 0

for (const [relPath, cfg] of Object.entries(PAGES)) {
  const fullPath = resolve(root, relPath)
  let content = readFileSync(fullPath, 'utf-8')

  const libPath = cfg.depth === 1 ? '../../lib' : '../../../lib'
  const compPath = cfg.depth === 1 ? '../_components' : '../../_components'

  // 1) Substitui import
  const importWithCtx = `import { requireMemberSession, withMemberContext } from '${libPath}/member-session'`
  const importNoCtx = `import { requireMemberSession } from '${libPath}/member-session'`
  const newImportsCtx =
    `import { withMemberContext } from '${libPath}/member-session'\n` +
    `import { requireMemberOrPassport } from '${libPath}/require-member-or-passport'\n` +
    `import { PassportNeedsLink } from '${compPath}/passport-needs-link'`
  const newImportsNoCtx =
    `import { requireMemberOrPassport } from '${libPath}/require-member-or-passport'\n` +
    `import { PassportNeedsLink } from '${compPath}/passport-needs-link'`

  if (content.includes(importWithCtx)) {
    content = content.replace(importWithCtx, newImportsCtx)
  } else if (content.includes(importNoCtx)) {
    content = content.replace(importNoCtx, newImportsNoCtx)
  } else {
    console.warn('SKIP (import not found):', relPath)
    skipped += 1
    continue
  }

  // 2) Substitui chamada
  const hidePropString = cfg.hideLinkButtons ? ' hideLinkButtons' : ''

  if (cfg.usesClaims) {
    const regex = /const session = await requireMemberSession\((['"])([^'"]+)\1\)/
    const match = content.match(regex)
    if (!match) {
      console.warn('SKIP (claim pattern not found):', relPath)
      skipped += 1
      continue
    }
    const route = match[2]
    const quote = match[1]
    const replacement =
      `const ctx = await requireMemberOrPassport(${quote}${route}${quote})\n` +
      `  if (ctx.kind === 'passport_needs_link') {\n` +
      `    return <PassportNeedsLink feature="${cfg.feature}"${hidePropString} />\n` +
      `  }\n` +
      `  const session = ctx.claims`
    content = content.replace(regex, replacement)
  } else {
    const regex = /await requireMemberSession\((['"])([^'"]+)\1\)/
    const match = content.match(regex)
    if (!match) {
      console.warn('SKIP (no-claim pattern not found):', relPath)
      skipped += 1
      continue
    }
    const route = match[2]
    const quote = match[1]
    const replacement =
      `const __ctx = await requireMemberOrPassport(${quote}${route}${quote})\n` +
      `  if (__ctx.kind === 'passport_needs_link') {\n` +
      `    return <PassportNeedsLink feature="${cfg.feature}"${hidePropString} />\n` +
      `  }`
    content = content.replace(regex, replacement)
  }

  // Write UTF-8 (no BOM)
  writeFileSync(fullPath, content, { encoding: 'utf8' })
  console.log('✓ migrated:', relPath)
  migrated += 1
}

console.log()
console.log(`Migrated: ${migrated}; Skipped: ${skipped}`)
