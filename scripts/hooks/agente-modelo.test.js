#!/usr/bin/env node
// =============================================================================
// Bateria do scripts/hooks/agente-modelo.mjs.
//
//   node scripts/hooks/agente-modelo.test.js
//
// O hook so pode agir num caso: chamada de subagente SEM `model`. Escolha
// explicita da sessao (haiku/opus) e fork ficam intocados, e o resto da
// chamada (prompt com aspas, quebras de linha) passa byte a byte.
// =============================================================================
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const HOOK = path.join(__dirname, 'agente-modelo.mjs');
function roda(entrada) {
  const r = spawnSync('node', [HOOK], { input: typeof entrada === 'string' ? entrada : JSON.stringify(entrada), encoding: 'utf8' });
  return { status: r.status, saida: r.stdout ? JSON.parse(r.stdout) : null };
}

const prompt = 'Ache "tenant_id" em\nbackend/internal\\x e diga \'onde\'.';
const casos = [
  ['Explore sem model -> sonnet, resto intacto', () => {
    const { status, saida } = roda({ tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'busca', prompt } });
    const u = saida?.hookSpecificOutput?.updatedInput;
    return status === 0 && u?.model === 'sonnet' && u.prompt === prompt && u.subagent_type === 'Explore' && u.description === 'busca';
  }],
  ['sem permissionDecision (nao pula prompt nem classificador)', () => {
    const h = roda({ tool_name: 'Agent', tool_input: { subagent_type: 'Plan', prompt: 'x' } }).saida?.hookSpecificOutput;
    return h?.updatedInput?.model === 'sonnet' && !('permissionDecision' in h);
  }],
  ['sem subagent_type (general-purpose) -> sonnet', () => roda({ tool_name: 'Agent', tool_input: { prompt: 'x' } }).saida?.hookSpecificOutput?.updatedInput?.model === 'sonnet'],
  ['agente de plugin/projeto intocado (frontmatter decide)', () => roda({ tool_name: 'Agent', tool_input: { prompt: 'x', subagent_type: 'pr-review-toolkit:code-reviewer' } }).saida === null],
  ['revisor-adversarial intocado (frontmatter sonnet)', () => roda({ tool_name: 'Agent', tool_input: { prompt: 'x', subagent_type: 'revisor-adversarial' } }).saida === null],
  ['model vazio conta como ausente', () => roda({ tool_name: 'Agent', tool_input: { prompt: 'x', model: '  ' } }).saida?.hookSpecificOutput?.updatedInput?.model === 'sonnet'],
  ['nome antigo da ferramenta (Task)', () => roda({ tool_name: 'Task', tool_input: { prompt: 'x' } }).saida?.hookSpecificOutput?.updatedInput?.model === 'sonnet'],
  ['opus explicito fica opus (sem saida)', () => { const r = roda({ tool_name: 'Agent', tool_input: { prompt: 'x', model: 'opus' } }); return r.status === 0 && r.saida === null; }],
  ['haiku explicito fica haiku (sem saida)', () => roda({ tool_name: 'Agent', tool_input: { prompt: 'x', model: 'haiku' } }).saida === null],
  ['fork intocado', () => roda({ tool_name: 'Agent', tool_input: { prompt: 'x', subagent_type: 'fork' } }).saida === null],
  ['outra ferramenta intocada', () => roda({ tool_name: 'Bash', tool_input: { command: 'ls' } }).saida === null],
  ['JSON invalido: falha aberta', () => { const r = roda('{nao e json'); return r.status === 0 && r.saida === null; }],
];

let falhas = 0;
for (const [desc, teste] of casos) {
  let ok = false;
  try { ok = teste(); } catch { ok = false; }
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${desc}`);
}
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
