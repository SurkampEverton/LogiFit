#!/usr/bin/env node
// =============================================================================
// PreToolUse(Agent|Task) - Claude Code
// Subagente sem `model` explicito roda em Sonnet, nao no modelo da sessao.
//
// POR QUE: medicao de 07/10/2026 (14 dias de transcricoes desta maquina) —
// 94 de 97 subagentes herdaram o Opus da sessao, inclusive os 63 Explore de
// busca. CLAUDE_CODE_SUBAGENT_MODEL (settings.json > env) cobre o
// general-purpose e os agentes sem `model:` no frontmatter, mas a doc diz que
// ele NAO muda o Explore nem o Plan embutidos. O parametro `model` passado na
// CHAMADA vence tudo (precedencia documentada em sub-agents#choose-a-model) —
// entao e' ele que este hook preenche quando a chamada veio sem.
//
// DINAMICO de proposito: se a sessao pediu um modelo (`haiku` para busca
// simples, `opus` para desenho dificil), o hook nao mexe. So o "esqueci de
// escolher" vira Sonnet. Regra de escolha: CLAUDE.md > Economia de contexto.
//
// SO OS EMBUTIDOS (Explore, Plan, general-purpose): agente de projeto ou de
// plugin tem `model:` no proprio frontmatter (pr-review-toolkit declara opus,
// o revisor-adversarial declara sonnet), e o parametro da chamada VENCE o
// frontmatter — preencher aqui atropelaria a escolha deles. Os sem `model:`
// ja caem no CLAUDE_CODE_SUBAGENT_MODEL. (Achado da revisao adversarial.)
//
// Fork (`subagent_type: "fork"`) herda a conversa e o cache do pai por
// construcao — trocar o modelo dele jogaria o cache fora. Fica intocado.
//
// So `updatedInput`, sem `permissionDecision`: um "allow" aqui pularia o
// prompt de permissao e o classificador do auto mode para toda chamada de
// subagente, e o hook nao tem nada a ver com permissao.
//
// Falha ABERTA: entrada ilegivel ou inesperada => sai 0 sem saida, e a chamada
// segue como veio. Um hook de economia nao pode travar o trabalho.
// =============================================================================
import { readFileSync } from 'node:fs';

const PADRAO = process.env.AGENTE_MODELO_PADRAO || 'sonnet';
const EMBUTIDOS = new Set(['', 'general-purpose', 'Explore', 'Plan']);

let entrada;
try {
  entrada = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const nome = entrada?.tool_name;
const input = entrada?.tool_input;
if ((nome !== 'Agent' && nome !== 'Task') || !input || typeof input !== 'object') process.exit(0);
if (typeof input.model === 'string' && input.model.trim() !== '') process.exit(0);
if (!EMBUTIDOS.has(input.subagent_type ?? '')) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    updatedInput: { ...input, model: PADRAO },
  },
}));
