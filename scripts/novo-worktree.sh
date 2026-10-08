#!/usr/bin/env bash
# =============================================================================
# novo-worktree.sh <branch> — cria o worktree de uma sessao (R-GIT-2).
#
#   bash scripts/novo-worktree.sh feat/sprint-XX-slug
#
# POR QUE ESTE SCRIPT EXISTE, e nao so um `git worktree add` no runbook:
# o `.worktreeinclude` e lido pelo CLAUDE CODE, nao pelo git. Worktree criado
# por `git worktree add` puro nasce SEM os arquivos listados la — sem
# .env.local o `pnpm dev` (dotenv -e .env.local) nao sobe, e nada na saida do
# git diz o porque.
#
# Entao: quem cria pelo app (Ctrl+N) ou por `claude --worktree` ja recebe os
# arquivos e NAO precisa deste script. Ele e para o caminho do terminal.
#
# Le o .worktreeinclude em vez de repetir os caminhos: quando alguem
# acrescentar uma linha la, este script acompanha sozinho. Dois `cp` fixos no
# runbook nao acompanhariam — e essa e a mesma classe de erro silencioso que a
# R-GIT-2 existe para evitar.
#
# NAO valida o nome da branch de proposito. A lista de prefixos ja vive em
# CLAUDE.md > Convencoes e em scripts/hooks/pre-push-guard.sh; mais uma copia
# daria mais uma chance de divergirem.
# =============================================================================
set -euo pipefail

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
  echo "uso: bash scripts/novo-worktree.sh <branch>" >&2
  echo "ex.: bash scripts/novo-worktree.sh feat/sprint-XX-slug" >&2
  exit 1
fi

# RAIZ e sempre o CHECKOUT PRINCIPAL, mesmo rodando de dentro de um worktree.
# `--show-toplevel` devolveria o worktree atual, e dali os arquivos do
# .worktreeinclude nao existem (e justamente o que estamos copiando). O
# `--git-common-dir` aponta para o `.git` do principal nos dois casos.
RAIZ="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
cd "$RAIZ"

# Nome do diretorio = ultimo segmento da branch. `feat/area/slug` vira
# `.claude/worktrees/slug`, e nao tres niveis de pasta.
SLUG="${BRANCH##*/}"
DESTINO="$RAIZ/.claude/worktrees/$SLUG"

if [ -e "$DESTINO" ]; then
  echo "ERRO: $DESTINO ja existe. Escolha outro nome ou remova com:" >&2
  echo "  git worktree remove \"$DESTINO\"" >&2
  exit 1
fi

# origin/main FRESCO. Worktree nascido de ref velha comeca atrasado e so
# descobre no merge.
echo ">> buscando origin/main..."
git fetch origin main --quiet

echo ">> criando worktree em .claude/worktrees/$SLUG na branch $BRANCH"
git worktree add "$DESTINO" -b "$BRANCH" origin/main

# ---------------------------------------------------------------------------
# Copia o que o .worktreeinclude lista.
#
# Trata caminho simples e glob — que e o que o arquivo tem hoje. Sintaxe
# completa de .gitignore (negacao com `!`, ancoragem) NAO e suportada; se
# alguem precisar disso, estenda aqui em vez de copiar a mao.
# ---------------------------------------------------------------------------
INCLUDE="$RAIZ/.worktreeinclude"
if [ ! -f "$INCLUDE" ]; then
  echo ">> sem .worktreeinclude — nada a copiar."
else
  echo ">> copiando arquivos do .worktreeinclude"
  while IFS= read -r linha || [ -n "$linha" ]; do
    padrao="${linha%%#*}"
    padrao="$(printf '%s' "$padrao" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -z "$padrao" ] && continue

    achou=0
    for origem in $padrao; do
      [ -f "$RAIZ/$origem" ] || continue
      achou=1
      mkdir -p "$DESTINO/$(dirname "$origem")"
      cp "$RAIZ/$origem" "$DESTINO/$origem"
      echo "   copiado: $origem"
    done

    # Falha em silencio e exatamente o que estamos combatendo: se o arquivo nao
    # existe no principal, o worktree nasce sem ele e o erro so aparece la na
    # frente, como "o app nao sobe".
    if [ "$achou" = 0 ]; then
      echo "   AVISO: '$padrao' nao existe no checkout principal — o worktree nasce SEM ele." >&2
    fi
  done < "$INCLUDE"
fi

echo ""
echo ">> pronto: $DESTINO"
echo ">> proximos passos:"
echo "     cd \"$DESTINO\""
echo "     claude"
echo ""
echo ">> dependencias: o worktree nasce sem node_modules. Dentro dele, rode:"
echo "     pnpm install --frozen-lockfile"
echo "   (o store do pnpm e compartilhado entre os checkouts, entao a instalacao"
echo "   reaproveita os pacotes ja baixados.)"
