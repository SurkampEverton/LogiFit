#!/usr/bin/env node
// =============================================================================
// SessionStart(startup|resume|clear|compact) - Claude Code
// Injeta um bloco CURTO (<= ~1.500 caracteres) com o estado da sessao e o
// HANDOFF dela, para a sessao continuar o fio depois de compactar, retomar ou
// limpar — sem o usuario colar nada.
//
// POR QUE: com a auto-compactacao em 300k (settings.json > autoCompactWindow) a
// sessao compacta ~4x mais que antes. O resumo do modelo perde detalhe; o que
// NAO pode se perder (worktree, branch, PR, decisoes, proximos passos) vem
// deste hook, lido do disco, igual em toda compactacao. /clear automatico nao
// existe (doc oficial): isto e' o mais automatico que a continuidade fica.
//
// CHAVE DO HANDOFF — varios chats rodam ao mesmo tempo, entao a chave NUNCA
// pode ser compartilhada:
// (<handoffs> = <pasta do Claude>/handoffs, resolvida por pasta-claude.mjs:
// nenhum caminho fixo — cada maquina tem a sua.)
//   - worktree: <handoffs>/<branch-slug>.md ('/' -> '__'). Unica por
//     garantia do git: dois worktrees nao tem a mesma branch em checkout.
//   - checkout PRINCIPAL (coordenacao/integracao): varias sessoes vivem na
//     mesma `main` ao mesmo tempo, entao a branch NAO serve. O arquivo e'
//     <handoffs>/coord-<frente>.md e a 1a linha e' `sessao: <id>`; o
//     hook acha o da SESSAO pelo session_id do JSON. Sem arquivo da propria
//     sessao, nao injeta nada — nunca o de outra frente.
//
// No principal sai SEMPRE uma linha com o session_id: e' o unico jeito de a
// coordenacao saber o proprio id para gravar o handoff. No worktree sai SEMPRE
// ao menos o caminho do handoff (muda por maquina). O resto so quando existe:
// cada caractere injetado e' relido em toda chamada da sessao.
//
// Falha ABERTA: qualquer erro => sai 0 sem saida. `gh` com timeout de 5 s;
// sem `gh` ou sem rede, a linha da PR some e o resto sai.
// =============================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pastaHandoffs, slugDaBranch } from './pasta-claude.mjs';

const DIR = process.env.ESTADO_SESSAO_HANDOFFS || pastaHandoffs();
const GH = process.env.ESTADO_SESSAO_GH || 'gh';
const MAX_HANDOFF = 1200;

const sair = (texto) => {
  if (texto) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: texto },
    }));
  }
  process.exit(0);
};

let entrada;
try {
  entrada = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  sair('');
}

const cwd = entrada?.cwd;
const sessao = entrada?.session_id || '';
if (!cwd || !existsSync(cwd)) sair('');

const run = (cmd, args, timeout = 5000) => {
  try {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, windowsHide: true });
    return r.status === 0 ? (r.stdout || '').trim() : '';
  } catch {
    return '';
  }
};
const git = (...args) => run('git', args);

const gitDir = git('rev-parse', '--path-format=absolute', '--git-dir');
const comum = git('rev-parse', '--path-format=absolute', '--git-common-dir');
if (!gitDir || !comum) sair('');
const principal = gitDir === comum;

const corta = (t) => (t.length > MAX_HANDOFF ? `${t.slice(0, MAX_HANDOFF)}\n[...cortado; leia o arquivo inteiro]` : t);
const lerHandoff = (arq) => {
  try {
    return corta(readFileSync(arq, 'utf8').trim());
  } catch {
    return '';
  }
};

if (principal) {
  if (!sessao) sair('');
  // Sem esta linha a coordenacao nunca saberia o proprio id, e o handoff dela
  // nunca seria achado (achado da revisao adversarial de 07/10/2026).
  const ident = `[estado da sessao - hook estado-sessao]\ncheckout principal (coordenacao/integracao) | sessao: ${sessao}\n`
    + `handoff desta sessao: ${join(DIR, 'coord-<frente>.md')} com a 1a linha "sessao: ${sessao}" (CLAUDE.md > Economia de contexto)`;
  if (!existsSync(DIR)) sair(ident);
  let achado = '';
  for (const nome of readdirSync(DIR)) {
    if (!nome.startsWith('coord-') || !nome.endsWith('.md')) continue;
    const arq = join(DIR, nome);
    let primeira = '';
    try {
      primeira = readFileSync(arq, 'utf8').split(/\r?\n/, 1)[0].trim();
    } catch {
      continue;
    }
    if (primeira === `sessao: ${sessao}`) {
      achado = arq;
      break;
    }
  }
  if (!achado) sair(ident);
  sair(`${ident}\nhandoff (${achado}):\n${lerHandoff(achado)}`);
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (!branch || branch === 'HEAD') sair('');
const slug = slugDaBranch(branch);
if (!slug) sair('');
const arqHandoff = join(DIR, `${slug}.md`);
const handoff = existsSync(arqHandoff) ? lerHandoff(arqHandoff) : '';
const commits = git('log', '--oneline', '-3', 'origin/main..HEAD');
const alterados = git('status', '--porcelain').split('\n').filter(Boolean).length;

// PR so e' consultada quando ja ha commit proprio: worktree recem-criado nao
// paga a ida a rede.
let pr = '';
if (commits) {
  const j = run(GH, ['pr', 'view', '--json', 'number,state', '--jq', '"#\\(.number) (\\(.state))"']);
  pr = j.replace(/^"|"$/g, '');
}

// O caminho sai SEMPRE: e' por maquina (pasta do Claude), e a sessao precisa
// dele para gravar o handoff no primeiro push.
const ondeGravar = `handoff desta sessao (grave a cada push): ${arqHandoff}`;
if (!handoff && !commits && !pr) sair(`[estado da sessao - hook estado-sessao]\n${ondeGravar}`);

const linhas = [
  '[estado da sessao - hook estado-sessao]',
  `worktree: ${run('git', ['rev-parse', '--show-toplevel'])} | branch: ${branch}${pr ? ` | PR: ${pr}` : ''} | alterados: ${alterados}`,
];
if (commits) linhas.push(`ultimos commits:\n${commits}`);
linhas.push(handoff ? `handoff (${arqHandoff}):\n${handoff}` : ondeGravar);
sair(linhas.join('\n'));
