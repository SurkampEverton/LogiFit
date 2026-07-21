#!/usr/bin/env node
/**
 * audit-tenant-scope — auditoria heurística de queries sem filtro de tenant.
 *
 * NÃO é gate de CI (regex não distingue vazamento de leitura global legítima,
 * herança de query anterior, ou rota de sistema — ver ADR 0107 e o histórico
 * do lint-custom). É uma FERRAMENTA DE REVISÃO rodada à mão: lista candidatos
 * para triagem humana/adversarial.
 *
 * Achou 2 vazamentos reais que uma varredura de 101 agentes tinha perdido
 * (exames/actions.ts + contas-receber/actions.ts, 2026-07-21) — por isso fica
 * no repo, mesmo não sendo automático.
 *
 * Heurística: para cada `.from|insert|update|delete(<T>)` onde T é tabela
 * tenant-scoped (schema tem coluna tenantId), checa se o STATEMENT drizzle
 * (balanço de parênteses a partir de `await db`/`tx`) menciona tenant_id —
 * seguindo também arrays de where montados antes (`const where = [...]`).
 *
 * Silencia com `// tenant-scope-exempt: <motivo>` no statement ou logo acima.
 * O motivo é obrigatório: isenção sem justificativa não é auditável depois.
 *
 * O que ele NÃO resolve (e por isso a triagem é humana): herança de escopo via
 * FK — quando o id já veio de uma query tenant-scoped anterior na mesma função.
 * Esse é o grosso dos candidatos remanescentes.
 *
 * Uso: node scripts/audit-tenant-scope.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const ROOT = process.cwd()
const IGNORE = new Set(['node_modules', '.next', 'dist', '.turbo', 'coverage', 'build', 'out'])

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (['.ts', '.tsx'].includes(extname(e.name))) out.push(p)
  }
  return out
}

// Tabelas tenant-scoped: pgTable cujo corpo declara tenantId.
const RE_PGTABLE = /export const (\w+)\s*=\s*pgTable\(\s*['"][^'"]+['"]\s*,\s*\{/g
const tenantScoped = new Set()
for (const f of walk(join(ROOT, 'packages/db/src/schema'))) {
  const src = readFileSync(f, 'utf8')
  let m
  while ((m = RE_PGTABLE.exec(src))) {
    // Corta no próximo `export const`. A janela fixa anterior (2500 chars)
    // vazava pra tabela seguinte e marcava GLOBAIS como tenant-scoped quando
    // vinham logo antes de uma tenant-scoped — permissions, role_permissions,
    // cid_catalog, cif_catalog e tuss_catalog entravam assim. Falso positivo
    // estrutural: o script errava a pergunta, não a resposta.
    const from = m.index + m[0].length
    const nextDecl = src.indexOf('\nexport const', from)
    const body = src.slice(from, nextDecl === -1 ? src.length : nextDecl)
    if (/\btenantId\s*:/.test(body)) tenantScoped.add(m[1])
  }
}

// Extrai o statement drizzle que contém idx (balanço de parênteses).
function statementAround(src, idx) {
  let start = Math.max(
    src.lastIndexOf('await db', idx),
    src.lastIndexOf('await tx', idx),
    src.lastIndexOf('db\n', idx),
    src.lastIndexOf('tx\n', idx),
  )
  if (start < 0 || idx - start > 2000) start = src.lastIndexOf('\n', idx)
  let depth = 0
  let end = idx
  for (let i = idx; i < src.length && i < idx + 2000; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ';' && depth <= 0) {
      end = i
      break
    }
    end = i
  }
  return src.slice(start, end + 1)
}

/**
 * Resolve o padrão "where-array": o filtro de tenant é montado num array antes
 * do statement (`const where = [eq(t.tenantId, tenantId)]` + `.push(...)`) e
 * consumido via spread. Olhar só o statement marcava todas essas telas de
 * listagem com filtro como suspeitas — era a maior fonte de ruído.
 *
 * Devolve o texto das declarações dos arrays citados no statement, para que a
 * checagem de `tenantId` os enxergue.
 */
function resolveWhereArrays(src, stmt, stmtStart) {
  const ids = new Set()
  for (const mm of stmt.matchAll(/\.\.\.(\w+)/g)) ids.add(mm[1])
  for (const mm of stmt.matchAll(/\(\s*(\w+)\s+as\s+never\s*\)/g)) ids.add(mm[1])
  for (const mm of stmt.matchAll(/\b(\w+)\[0\]/g)) ids.add(mm[1])
  let extra = ''
  for (const id of ids) {
    // Declaração + os pushes subsequentes, tudo antes do statement
    const declIdx = src.lastIndexOf(`const ${id} = [`, stmtStart)
    if (declIdx === -1) continue
    extra += src.slice(declIdx, stmtStart)
  }
  return extra
}

const RE_QUERY = /\.(from|insert|update|delete)\(\s*(\w+)\s*[),]/g
const candidates = []
for (const f of walk(join(ROOT, 'apps'))) {
  if (f.includes('.test.')) continue
  const src = readFileSync(f, 'utf8')
  let m
  while ((m = RE_QUERY.exec(src))) {
    if (!tenantScoped.has(m[2])) continue
    const stmt = statementAround(src, m.index)
    // Preâmbulo: a isenção é escrita como comentário ACIMA do statement, que é
    // onde ela se lê melhor — sem isso o script só a enxergaria se estivesse
    // no meio da query.
    const stmtStart = src.lastIndexOf(stmt, m.index)
    const preamble = src.slice(Math.max(0, stmtStart - 400), stmtStart)
    const scope = stmt + resolveWhereArrays(src, stmt, m.index)
    if (/tenant[_ ]?[iI]d|tenant-scope-exempt/.test(scope)) continue
    if (/tenant-scope-exempt/.test(preamble)) continue
    const line = src.slice(0, m.index).split(/\r?\n/).length
    candidates.push({ file: relative(ROOT, f).split('\\').join('/'), line, op: m[1], table: m[2] })
  }
}

if (candidates.length === 0) {
  console.log('✓ audit-tenant-scope: nenhum candidato (todo statement menciona tenant)')
  process.exit(0)
}
console.log(
  `audit-tenant-scope: ${candidates.length} candidato(s) — REVISAR À MÃO (podem ser falsos positivos: where-array, herança, catálogo global, rota de sistema)\n`,
)
for (const c of candidates) console.log(`  ${c.file}:${c.line}  .${c.op}(${c.table})`)
// Nunca falha o processo: é auditoria, não gate.
process.exit(0)
