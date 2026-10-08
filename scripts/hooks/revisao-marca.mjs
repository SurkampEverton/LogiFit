#!/usr/bin/env node
// =============================================================================
// SubagentStop - Claude Code
// Quando o agente `revisor-adversarial` TERMINA a revisao, grava a MARCA da
// branch revisada em <pasta do Claude>/handoffs/.revisao/<branch-slug>. O
// revisao-guard so libera `gh pr create` com marca valida.
//
// A marca so nasce da ULTIMA linha que o revisor e' obrigado a escrever:
//     REVISADO: <branch> <sha de 40 hex>
// Sem ela (erro, maxTurns, revisao interrompida) nao ha marca — e o guard pede
// a revisao de novo, que e' o lado seguro. A branch vem dessa linha, e NAO do
// diretorio de quem chamou: a coordenacao no checkout principal (branch main)
// revisa worktrees por `git -C`, e a marca tem de ir para a branch revisada.
// (Achado da revisao adversarial de 07/10/2026: a 1a versao marcava "main".)
//
// Le a linha de `last_assistant_message` quando o Claude Code a manda; se nao,
// da ultima mensagem do agente no `agent_transcript_path` — texto OU o handback:
// o revisor que entrega por SubagentHandback nao deixa texto, e a linha
// REVISADO fica no input.message do tool_use (PR #1696 e #1711).
//
// Por BRANCH e fora do repositorio: sessoes paralelas nunca disputam a mesma
// marca (o git nao deixa dois worktrees com a mesma branch em checkout).
// Falha ABERTA: qualquer erro => nao grava e sai 0.
// =============================================================================
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pastaHandoffs, slugDaBranch } from './pasta-claude.mjs';

const AGENTE = 'revisor-adversarial';
const DIR = process.env.REVISAO_DIR || join(pastaHandoffs(), '.revisao');
const LINHA = /^REVISADO:\s+(\S+)\s+([0-9a-f]{40})\s*$/m;

// Handback e' tool_use: o relatorio vem em input.message, e nao num bloco text.
// SO o SubagentHandback conta: um Bash/Grep com a linha REVISADO no comando,
// seguido de interrupcao, nao pode virar marca (revisao adversarial, 08/10).
function textoDoBloco(c) {
  if (c?.type === 'text') return c.text;
  if (c?.type === 'tool_use' && c.name === 'SubagentHandback' && typeof c.input?.message === 'string') {
    return c.input.message;
  }
  return '';
}

function ultimaFalaDoAgente(caminho) {
  if (!caminho || !existsSync(caminho)) return '';
  let ultima = '';
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    if (!linha.includes('"assistant"')) continue;
    try {
      const j = JSON.parse(linha);
      if (j.type !== 'assistant' || !Array.isArray(j.message?.content)) continue;
      const texto = j.message.content.map(textoDoBloco).join('\n');
      if (texto.trim()) ultima = texto;
    } catch {
      // linha parcial: ignora
    }
  }
  return ultima;
}

try {
  const entrada = JSON.parse(readFileSync(0, 'utf8'));
  if (entrada?.agent_type === AGENTE) {
    const fala = typeof entrada.last_assistant_message === 'string' && LINHA.test(entrada.last_assistant_message)
      ? entrada.last_assistant_message
      : ultimaFalaDoAgente(entrada.agent_transcript_path);
    const m = LINHA.exec(fala);
    const slug = m ? slugDaBranch(m[1]) : null;
    if (slug) {
      const [, branch, sha] = m;
      mkdirSync(DIR, { recursive: true });
      writeFileSync(join(DIR, slug),
        `branch: ${branch}\nsha: ${sha}\nem: ${new Date().toISOString()}\nsessao: ${entrada.session_id || ''}\n`);
    }
  }
} catch {
  // falha aberta
}
