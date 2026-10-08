// =============================================================================
// Onde fica a pasta de configuracao do Claude Code NESTA maquina.
//
// Nenhum script do time presume caminho: cada computador tem o repositorio
// numa pasta diferente e a pasta do Claude pode ter sido movida com
// CLAUDE_CONFIG_DIR. Ordem: CLAUDE_CONFIG_DIR, senao <home>/.claude.
//
// Usado por estado-sessao, revisao-guard, revisao-marca e scripts/claude-uso.
// =============================================================================
import { homedir } from 'node:os';
import { join } from 'node:path';

export const pastaClaude = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
export const pastaHandoffs = () => join(pastaClaude(), 'handoffs');

// Nome de arquivo (handoff, marca de revisao) a partir da branch: '/' -> '__'.
// Devolve null para nome que nao e' branch valida — sobretudo `..` e barra
// invertida, que levariam a gravacao para FORA da pasta (a branch da marca vem
// de texto escrito pelo modelo; achado da revisao adversarial de 07/10/2026).
export function slugDaBranch(branch) {
  if (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(branch)) return null;
  if (branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.lock')) return null;
  return branch.replaceAll('/', '__');
}
