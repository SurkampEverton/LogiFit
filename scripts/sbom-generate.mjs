#!/usr/bin/env node
/**
 * SBOM (Software Bill of Materials) gen — CycloneDX format (regra 18 + ADR 0073).
 *
 * Roda `cdxgen` (npx, sem dep persistente) contra a raiz do monorepo e produz
 * sboms/v<version>.json. Inclui em release tag manualmente — não rola em CI
 * pra todo PR (custa minutos).
 *
 * Uso:
 *   pnpm sbom:generate              # versão vem do CHANGELOG
 *   pnpm sbom:generate 1.0.0-rc.1   # versão explícita
 *
 * Output: sboms/v<version>.json (gitignored em sboms/.gitignore — só publica
 * em release tag se quiser; rodar em release script).
 *
 * Pré-requisito: npm/npx instalado (não vem com pnpm).
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const SBOM_DIR = join(REPO_ROOT, 'sboms')

function resolveVersion() {
  const argv = process.argv[2]
  if (argv) return argv
  // Fallback: extrai primeira versão "x.y.z" do CHANGELOG
  const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8')
  const match = changelog.match(/##\s*\[(\d+\.\d+\.\d+[^\]]*)\]/m)
  return match ? match[1] : 'unreleased'
}

function main() {
  const version = resolveVersion()
  if (!existsSync(SBOM_DIR)) mkdirSync(SBOM_DIR)
  const outFile = join(SBOM_DIR, `v${version}.json`)
  console.log(`[sbom] gerando ${outFile} (CycloneDX) via npx @cyclonedx/cdxgen…`)
  try {
    execSync(
      `npx --yes @cyclonedx/cdxgen@latest -o ${outFile} -t nodejs --required-only --spec-version 1.5`,
      { stdio: 'inherit', cwd: REPO_ROOT },
    )
    console.log(`[sbom] OK — ${outFile}`)
  } catch (err) {
    console.error('[sbom] FAILED', err)
    process.exit(1)
  }
}

main()
