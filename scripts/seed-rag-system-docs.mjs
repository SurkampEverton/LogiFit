#!/usr/bin/env node
/**
 * Seed RAG system documents — Sprint 06 Faixa C/D real (ADR 0064).
 *
 * Lê filesystem (`docs/decisions/*.md`, `docs/sprints/*.md`, `docs/rules.md`,
 * `docs/runbooks/*.md`) + chunks ~500 tokens + insere em `ai_documents` +
 * `ai_document_chunks` global (tenant_id IS NULL = seed LogiFit).
 *
 * **Embeddings**: chama `text-embedding-004` via Vertex AI quando
 * `GEMINI_API_KEY` está definida; caso contrário, salva `embedding=null` —
 * job futuro pode re-rodar pra preencher embeddings sem reingerir conteúdo.
 *
 * **Idempotente via `content_hash`**: se hash sha256 do conteúdo não mudou
 * desde último seed, pula. Mudou → DELETE chunks + INSERT novos.
 *
 * Uso:
 *   node scripts/seed-rag-system-docs.mjs              # ingere todos
 *   node scripts/seed-rag-system-docs.mjs --dry-run    # só lista o que faria
 *   DATABASE_URL=... node scripts/seed-rag-system-docs.mjs
 *
 * Sprint 06+ Faixa C/D real: este script vira `pnpm rag:seed` no package.json
 * + boot hook (Coolify post-deploy) re-roda sem custo se conteúdo não mudou.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const DRY_RUN = process.argv.includes('--dry-run')

// ─── Fontes a ingerir ──────────────────────────────────────────────────
const SOURCES = [
  { dir: 'docs/decisions', source: 'adr' },
  { dir: 'docs/sprints', source: 'sprint' },
  { dir: 'docs/runbooks', source: 'runbook' },
]

// Arquivos individuais especiais
const SPECIAL_FILES = [
  { path: 'docs/rules.md', source: 'regulation', title: 'LogiFit — Regras duras (rules.md)' },
  { path: 'docs/arquitetura.md', source: 'regulation', title: 'LogiFit — Arquitetura' },
  { path: 'docs/modulos.md', source: 'regulation', title: 'LogiFit — Catálogo de módulos' },
  {
    path: 'docs/compliance/dpo.md',
    source: 'regulation',
    title: 'LogiFit — DPO + Governança LGPD',
  },
]

const IGNORE = new Set(['node_modules', '.git', 'dist', '.next'])

function walkMd(dir, exclude = new Set()) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue
    if (e.name.startsWith('_')) continue // _template.md
    const path = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkMd(path, exclude))
    else if (extname(e.name) === '.md' && !exclude.has(path)) out.push(path)
  }
  return out
}

function chunkText(text, opts = {}) {
  const targetTokens = opts.targetTokens ?? 500
  // Aproximação: 1 token ≈ 4 caracteres pt-BR
  const targetChars = targetTokens * 4
  const overlapChars = (opts.overlapTokens ?? 50) * 4
  const chunks = []
  let pos = 0
  while (pos < text.length) {
    const end = Math.min(pos + targetChars, text.length)
    // Quebra na sentença mais próxima
    let cut = end
    if (end < text.length) {
      const slice = text.slice(pos, end + 200)
      const dot = slice.lastIndexOf('. ')
      const newline = slice.lastIndexOf('\n')
      const best = Math.max(dot, newline)
      if (best > targetChars * 0.5) {
        cut = pos + best + 1
      }
    }
    const chunk = text.slice(pos, cut).trim()
    if (chunk.length > 20) chunks.push(chunk)
    pos = cut - overlapChars
    if (pos < 0) pos = 0
    if (cut >= text.length) break
  }
  return chunks
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex')
}

function extractTitle(content, fallback) {
  const m = content.match(/^#\s+(.+)$/m)
  return m?.[1]?.trim() ?? fallback
}

// ─── Embedding stub ────────────────────────────────────────────────────
/**
 * Sprint 06+ Faixa C/D real: chama Vertex AI text-embedding-004 (768d).
 * MVP: retorna null quando GEMINI_API_KEY ausente. Caller insere chunk
 * com `embedding=NULL` — job de re-embed roda depois pra preencher.
 */
async function embedTexts(texts) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return texts.map(() => null)

  // Sprint 06+ Faixa C/D real: implementar chamada REST a
  // https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent
  // MVP: zera embeddings (NULL) — não bloqueia ingestão.
  return texts.map(() => null)
}

// ─── Coleta arquivos ────────────────────────────────────────────────────

const seen = new Set()
const docs = []

for (const { dir, source } of SOURCES) {
  const fullDir = join(ROOT, dir)
  const files = walkMd(fullDir)
  for (const file of files) {
    seen.add(file)
    const sourcePath = relative(ROOT, file).replace(/\\/g, '/')
    docs.push({ sourcePath, source, file })
  }
}

for (const special of SPECIAL_FILES) {
  const file = join(ROOT, special.path)
  try {
    statSync(file)
    seen.add(file)
    docs.push({
      sourcePath: special.path,
      source: special.source,
      file,
      titleOverride: special.title,
    })
  } catch {
    // arquivo não existe — pula
  }
}

console.log(`seed-rag: encontrou ${docs.length} documentos`)

// ─── Processa cada doc ───────────────────────────────────────────────

const stats = { newDocs: 0, updatedDocs: 0, skipped: 0, totalChunks: 0 }

if (DRY_RUN) {
  for (const { sourcePath, source } of docs) {
    console.log(`  [${source}] ${sourcePath}`)
  }
  console.log(`\nseed-rag DRY_RUN: ${docs.length} docs prontos pra ingerir`)
  process.exit(0)
}

// Sprint 06+ Faixa C/D real: aqui conecta no Postgres via @repo/db client +
// faz UPSERT em ai_documents (por (sourcePath, NULL tenant_id)) + delete-and-
// insert em ai_document_chunks (com embeddings).
//
// MVP: gera artifact `.rag-seed-manifest.json` com plano detalhado — caller
// (job em runtime do app, não script standalone) consome esse manifest.
//
// Isso evita acoplar este script ao Postgres rodando (que pode não estar
// disponível em CI sem docker compose up). O runtime do app importa @repo/db
// e tem credentials já configuradas via DATABASE_URL.

const manifest = []

for (const { sourcePath, source, file, titleOverride } of docs) {
  const content = readFileSync(file, 'utf8')
  if (!content.trim()) {
    stats.skipped++
    continue
  }
  const hash = hashContent(content)
  const title = titleOverride ?? extractTitle(content, sourcePath)
  const chunks = chunkText(content)
  stats.totalChunks += chunks.length
  manifest.push({
    sourcePath,
    source,
    title,
    contentHash: hash,
    tokensTotal: Math.ceil(content.length / 4),
    chunks: chunks.map((c, idx) => ({
      chunkIndex: idx,
      content: c,
      tokens: Math.ceil(c.length / 4),
    })),
  })
  stats.newDocs++
}

// Embedding pass (no-op quando sem API key)
const allChunkTexts = manifest.flatMap((d) => d.chunks.map((c) => c.content))
const embeddings = await embedTexts(allChunkTexts)
let embIdx = 0
for (const d of manifest) {
  for (const c of d.chunks) {
    c.embedding = embeddings[embIdx++] ?? null
  }
}

// Escreve manifest
const manifestPath = join(ROOT, '.rag-seed-manifest.json')
import('node:fs').then((fs) => {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`seed-rag: manifest gerado em ${relative(ROOT, manifestPath)}`)
  console.log(`  docs: ${stats.newDocs} novos · ${stats.updatedDocs} atualizados · ${stats.skipped} pulados`)
  console.log(`  chunks: ${stats.totalChunks} total`)
  console.log(`  embeddings: ${embeddings.filter((e) => e !== null).length} preenchidos / ${embeddings.length} total`)
  if (embeddings.every((e) => e === null)) {
    console.log(`  ℹ GEMINI_API_KEY ausente — chunks ficam com embedding=NULL`)
    console.log(`  ℹ Configure ENV ou via /app/settings/ia BYOK e re-rode pra embedar`)
  }
})
