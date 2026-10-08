#!/usr/bin/env bash
# =============================================================================
# PreToolUse(Bash|PowerShell) - Claude Code
# Recusa `gh pr create` enquanto a branch nao passou pelo agente
# `revisor-adversarial` (.claude/agents/revisor-adversarial.md).
#
# Este .sh e' so a SAIDA ANTECIPADA: o hook roda em TODO comando de shell, e
# so quem tem "gh", "pr" e "create" no texto (nessa ordem) paga o node. A
# decisao — analisador de shell que entende aspas, heredoc e comentario, e a
# validacao da marca — mora em revisao-guard.mjs. EXIT 2 e' o que bloqueia.
#
# POR QUE: na rodada de 27/09/2026, 3 de 5 frentes chegaram ao push reprovando
# guarda que nao tinham rodado (memoria agentes-em-paralelo-cota-e-worktree).
# A revisao adversarial pega isso ANTES da PR, com Sonnet lendo so o diff.
# =============================================================================
input=$(cat 2>/dev/null || echo '{}')
case "$input" in
  *gh*pr*create*) ;;
  *) exit 0 ;;
esac
printf '%s' "$input" | node "$(dirname "$0")/revisao-guard.mjs"
