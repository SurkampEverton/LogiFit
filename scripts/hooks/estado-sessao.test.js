#!/usr/bin/env node
// =============================================================================
// Bateria do scripts/hooks/estado-sessao.mjs.
//
//   node scripts/hooks/estado-sessao.test.js
//
// O ponto que mais importa: VARIOS CHATS AO MESMO TEMPO. Cada sessao recebe so
// o PROPRIO handoff — no checkout principal pela linha `sessao: <id>`, no
// worktree pela branch — e nunca o de outra. Tambem: silencio quando nao ha o
// que dizer, corte em ~1.200 caracteres, e sem `gh` o hook nao trava.
//
// HERMETICO: repositorio, worktrees e handoffs em diretorio temporario
// (ESTADO_SESSAO_HANDOFFS); `gh` apontado para um binario inexistente.
// =============================================================================
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, 'estado-sessao.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'estado-test-'));
const HANDOFFS = path.join(TMP, 'handoffs');
fs.mkdirSync(HANDOFFS);
const env = { ...process.env, ESTADO_SESSAO_HANDOFFS: HANDOFFS, ESTADO_SESSAO_GH: path.join(TMP, 'gh-inexistente') };

const PRINCIPAL = path.join(TMP, 'principal');
fs.mkdirSync(PRINCIPAL);
const git = (dir, ...a) => spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
git(PRINCIPAL, 'init', '-q', '-b', 'main');
git(PRINCIPAL, 'commit', '-q', '--allow-empty', '-m', 'base');
git(PRINCIPAL, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
const WT1 = path.join(TMP, 'wt1');
const WT2 = path.join(TMP, 'wt2');
git(PRINCIPAL, 'worktree', 'add', '-q', '-b', 'feat/a/b', WT1);
git(PRINCIPAL, 'worktree', 'add', '-q', '-b', 'feat/a-b', WT2);
git(WT1, 'commit', '-q', '--allow-empty', '-m', 'commit-proprio-do-wt1');

const escreve = (nome, txt) => fs.writeFileSync(path.join(HANDOFFS, nome), txt);
function roda(cwd, sessao, entradaCrua) {
  const input = entradaCrua ?? JSON.stringify({ cwd, session_id: sessao, hook_event_name: 'SessionStart', source: 'compact' });
  const r = spawnSync('node', [HOOK], { input, encoding: 'utf8', env, timeout: 20000 });
  if (r.status !== 0) return { status: r.status, txt: null };
  return { status: 0, txt: r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '' };
}

const casos = [
  ['principal sem handoff -> so a linha com o PROPRIO session_id', () => {
    const t = roda(PRINCIPAL, 's1').txt;
    return t.includes('sessao: s1') && t.includes('coord-<frente>.md') && !t.includes('handoff (');
  }],
  ['principal: cada sessao recebe SO a sua frente', () => {
    escreve('coord-rh.md', 'sessao: s1\nfrente RH: onda 2, PRs 10-12');
    escreve('coord-release.md', 'sessao: s2\nfrente release: v0.7.410');
    const a = roda(PRINCIPAL, 's1').txt;
    const b = roda(PRINCIPAL, 's2').txt;
    return a.includes('frente RH') && !a.includes('frente release') && b.includes('frente release') && !b.includes('frente RH');
  }],
  ['principal: sessao sem arquivo proprio -> so o id (nunca o de outra)', () => {
    const t = roda(PRINCIPAL, 's3').txt;
    return t.includes('sessao: s3') && !t.includes('frente RH') && !t.includes('frente release') && !t.includes('handoff (');
  }],
  ['principal: id so no meio do arquivo NAO casa', () => {
    escreve('coord-falso.md', 'frente X\nsessao: s4');
    return !roda(PRINCIPAL, 's4').txt.includes('frente X');
  }],
  ['worktree com commit e handoff -> branch, commit e handoff', () => {
    escreve('feat__a__b.md', 'handoff-do-wt1: falta rodar migrate');
    const t = roda(WT1, 'w1').txt;
    return t.includes('branch: feat/a/b') && t.includes('commit-proprio-do-wt1') && t.includes('handoff-do-wt1');
  }],
  ['worktree sem commit e sem handoff -> so o caminho do handoff (por maquina)', () => {
    const t = roda(WT2, 'w2').txt;
    return t.includes(path.join(HANDOFFS, 'feat__a-b.md')) && !t.includes('handoff-do-wt1') && t.length < 400;
  }],
  ['pasta do Claude vem de CLAUDE_CONFIG_DIR (sem caminho fixo)', () => {
    const outra = path.join(TMP, 'config-movida');
    const r = spawnSync('node', [HOOK], {
      input: JSON.stringify({ cwd: WT2, session_id: 'w2' }), encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: outra, ESTADO_SESSAO_HANDOFFS: '', ESTADO_SESSAO_GH: env.ESTADO_SESSAO_GH },
    });
    return r.stdout.includes(path.join(outra, 'handoffs', 'feat__a-b.md').replace(/\\/g, '\\\\'));
  }],
  ['feat/a-b nao colide com feat/a/b', () => {
    escreve('feat__a-b.md', 'handoff-do-wt2');
    const t = roda(WT2, 'w2').txt;
    return t.includes('handoff-do-wt2') && !t.includes('handoff-do-wt1');
  }],
  ['handoff grande e cortado (bloco <= ~1.700 caracteres)', () => {
    escreve('feat__a__b.md', 'x'.repeat(5000));
    const t = roda(WT1, 'w1').txt;
    return t.includes('[...cortado') && t.length <= 1700;
  }],
  ['sem gh: nao trava e o resto sai', () => roda(WT1, 'w1').txt.includes('branch: feat/a/b')],
  ['JSON invalido: falha aberta', () => { const r = roda(null, null, '{x'); return r.status === 0 && r.txt === ''; }],
  ['cwd inexistente: falha aberta', () => roda(path.join(TMP, 'nao-existe'), 's1').txt === ''],
];

let falhas = 0;
for (const [desc, teste] of casos) {
  let ok = false;
  try { ok = teste(); } catch (e) { ok = false; console.log(`      erro: ${e.message}`); }
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${desc}`);
}

git(PRINCIPAL, 'worktree', 'remove', '--force', WT1);
git(PRINCIPAL, 'worktree', 'remove', '--force', WT2);
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${casos.length - falhas}/${casos.length} passaram`);
process.exit(falhas ? 1 : 0);
