#!/usr/bin/env node
// docs-check.mjs — lint custom para documentação LogiFit
//
// 4 validações que historicamente causaram bugs (auditorias 11-16):
//   A. Número no H1 do ADR bate com filename (ex: "# ADR 0035" em arquivo "0035-*.md")
//      — slug é livre (é abreviação intencional do título); só o número é invariante
//   B. Todo link markdown relativo dentro de docs/ aponta para arquivo existente
//   C. "ADR NNNN (esperado)" em sprint não colide com ADR já publicado nem com outra sprint
//   D. DoD "Roadmap: sprint NNN → done" em sprint NN-* bate com NN do filename
//
// Uso: node scripts/docs-check.mjs
// Saída: lista de problemas + exit 1 se houver erros; exit 0 se limpo.
// Sem dependências externas — roda com Node 20+ em qualquer ambiente.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DOCS_DIR = join(REPO_ROOT, 'docs');

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const errors = [];
const warnings = [];

function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

// ────────────────────────────────────────────────────────────────────────────
// Helpers

async function walk(dir, results = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, results);
    else if (entry.isFile() && entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

function rel(p) { return relative(REPO_ROOT, p).replace(/\\/g, '/'); }

// ────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO A — Número no H1 do ADR bate com filename

async function checkAdrSlugMatchesFilename() {
  const decisionsDir = join(DOCS_DIR, 'decisions');
  const files = (await readdir(decisionsDir)).filter(f => /^\d{4}-.+\.md$/.test(f));
  for (const filename of files) {
    const fullPath = join(decisionsDir, filename);
    const content = await readFile(fullPath, 'utf8');
    const h1 = content.match(/^#\s+ADR\s+(\d{4})\s*[—–-]\s*(.+?)\s*$/m);
    if (!h1) {
      warn(`${rel(fullPath)} — sem H1 no formato "# ADR NNNN — Título"`);
      continue;
    }
    const [, h1Number] = h1;
    const filenameMatch = filename.match(/^(\d{4})-(.+)\.md$/);
    const [, fileNumber] = filenameMatch;
    if (h1Number !== fileNumber) {
      err(`${rel(fullPath)} — número no H1 (${h1Number}) difere do filename (${fileNumber})`);
    }
    // slug é livre (abreviação do título por design); não validamos overlap
  }
}

// ────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO B — links markdown relativos para .md dentro de docs/ resolvem

const LINK_RE = /\[([^\]]*)\]\(([^)]+?)(?:\s+"[^"]*")?\)/g;

async function checkRelativeMarkdownLinks() {
  const allMd = await walk(DOCS_DIR);
  // Inclui CLAUDE.md, CHANGELOG.md, README.md na raiz
  for (const root of ['CLAUDE.md', 'CHANGELOG.md', 'README.md']) {
    const p = join(REPO_ROOT, root);
    if (existsSync(p)) allMd.push(p);
  }

  for (const file of allMd) {
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // skip code blocks (heurística simples)
      if (line.trim().startsWith('```')) continue;

      let match;
      LINK_RE.lastIndex = 0;
      while ((match = LINK_RE.exec(line)) !== null) {
        const href = match[2].trim();
        // só interessa link relativo para .md (com possível #anchor)
        if (/^https?:|^mailto:|^#|^tel:/.test(href)) continue;
        const [pathOnly] = href.split('#');
        if (!pathOnly) continue;
        if (!pathOnly.endsWith('.md')) continue;
        // resolve relativo ao arquivo
        const baseDir = dirname(file);
        const target = resolve(baseDir, pathOnly);
        if (!existsSync(target)) {
          err(`${rel(file)}:${i + 1} — link quebrado: "${pathOnly}" (resolve para ${rel(target)} que não existe)`);
        }
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO C — "ADR NNNN (esperado)" não colide

async function checkAdrCollisions() {
  const sprintsDir = join(DOCS_DIR, 'sprints');
  const sprintFiles = (await readdir(sprintsDir)).filter(f => f.endsWith('.md') && f !== '_template.md');

  // Mapa: número ADR -> [{sprint, line, contexto}]
  const claims = new Map();

  // Padrão "ADR 0NNN (esperado)" — o "(esperado)" é a marca explícita de claim de produção
  const ADR_ESPERADO_RE = /\bADR\s+(\d{4})\s*\(esperado/g;

  for (const filename of sprintFiles) {
    const fullPath = join(sprintsDir, filename);
    const content = await readFile(fullPath, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('```')) continue;
      let match;
      ADR_ESPERADO_RE.lastIndex = 0;
      while ((match = ADR_ESPERADO_RE.exec(line)) !== null) {
        const num = match[1];
        if (!claims.has(num)) claims.set(num, []);
        claims.get(num).push({ sprint: filename, line: i + 1, snippet: line.trim().slice(0, 120) });
      }
    }
  }

  // ADRs já publicados (filenames em decisions/)
  const decisionsDir = join(DOCS_DIR, 'decisions');
  const publishedAdrs = new Set();
  for (const f of await readdir(decisionsDir)) {
    const m = f.match(/^(\d{4})-/);
    if (m) publishedAdrs.add(m[1]);
  }

  // Verifica colisões
  for (const [num, list] of claims.entries()) {
    if (publishedAdrs.has(num)) {
      err(`ADR ${num} já está PUBLICADO em docs/decisions/ mas é citado como "(esperado)" em:`);
      for (const c of list) {
        err(`    ${c.sprint}:${c.line} — ${c.snippet}`);
      }
    }
    // 2+ sprints distintas reivindicando o mesmo número — colisão (mesma sprint pode ter múltiplas menções)
    const distinctSprints = new Set(list.map(c => c.sprint));
    if (distinctSprints.size > 1) {
      err(`ADR ${num} reivindicado por ${distinctSprints.size} sprints distintas:`);
      for (const c of list) {
        err(`    ${c.sprint}:${c.line} — ${c.snippet}`);
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO D — DoD "Roadmap: sprint NNN → done" bate com NN do filename
//
// Padrão histórico de bug: sprint copia DoD da anterior e esquece de atualizar
// o número (ex: sprint 28 diz "Roadmap: sprint 24 → done"). Lint faz match
// estrito: sprint NN-* deve dizer "Roadmap: sprint NN → done" (zero-padded).

async function checkSprintDodMatchesFilename() {
  const sprintsDir = join(DOCS_DIR, 'sprints');
  const sprintFiles = (await readdir(sprintsDir)).filter(f => f.endsWith('.md') && f !== '_template.md');

  const ROADMAP_DOD_RE = /Roadmap:\s+sprint\s+(\S+?)\s+→/g;

  for (const filename of sprintFiles) {
    const filenameMatch = filename.match(/^(\d{2}b?|\d{2}[ab]?)-/);
    if (!filenameMatch) continue;
    const expectedNum = filenameMatch[1]; // "00", "00b", "01a", "01b", "19b", "20", etc

    const fullPath = join(sprintsDir, filename);
    const content = await readFile(fullPath, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('```')) continue;
      let match;
      ROADMAP_DOD_RE.lastIndex = 0;
      while ((match = ROADMAP_DOD_RE.exec(line)) !== null) {
        const dodNum = match[1];
        if (dodNum !== expectedNum) {
          err(`${rel(fullPath)}:${i + 1} — DoD diz "sprint ${dodNum}" mas filename é sprint ${expectedNum}: ${line.trim()}`);
        }
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main

async function main() {
  console.log(`${DIM}docs-check — auditando documentação em ${rel(DOCS_DIR)}/${RESET}\n`);

  await checkAdrSlugMatchesFilename();
  await checkRelativeMarkdownLinks();
  await checkAdrCollisions();
  await checkSprintDodMatchesFilename();

  if (warnings.length) {
    console.log(`${YELLOW}⚠ ${warnings.length} aviso(s):${RESET}`);
    for (const w of warnings) console.log(`  ${YELLOW}•${RESET} ${w}`);
    console.log('');
  }

  if (errors.length) {
    console.log(`${RED}✘ ${errors.length} erro(s):${RESET}`);
    for (const e of errors) console.log(`  ${RED}•${RESET} ${e}`);
    console.log('');
    console.log(`${RED}docs-check FALHOU${RESET}`);
    process.exit(1);
  }

  console.log(`${GREEN}✓ docs-check passou (0 erros, ${warnings.length} avisos)${RESET}`);
}

main().catch(e => {
  console.error(`${RED}docs-check crashou:${RESET}`, e);
  process.exit(2);
});
