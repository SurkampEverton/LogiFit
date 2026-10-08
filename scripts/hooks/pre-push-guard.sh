#!/usr/bin/env bash
# =============================================================================
# PreToolUse(Bash|PowerShell) - Claude Code
# Recusa `git push`/`git commit` que toque a branch principal (main/master).
#
# EXIT 2 e o que BLOQUEIA no Claude Code. Sair 1 so imprime um aviso e deixa o
# comando acontecer — um guard que reclama e libera e pior que nenhum, porque
# parece que protege.
#
# Duas decisoes, em ordem:
#   1) Pelo TEXTO: push cujo refspec mira main/master (`origin main`,
#      `HEAD:main`, `feat/x:main`, `+main`) e bloqueado de QUALQUER branch.
#   2) Pelo ESTADO: estando NA main, `git push` sem argumentos empurraria para
#      a main — informacao que nenhum deny textual enxerga. Na main, so passa
#      push que mira EXPLICITAMENTE uma feature branch; commit nao passa nunca.
#
# A analise e POR SEGMENTO do comando (ver "segmentacao" abaixo), nao sobre a
# string inteira: `git checkout main && git push origin feat/x` e um push
# legitimo de feature branch, e o scan sobre a string toda o bloqueava pelo
# token `main` do checkout — falso positivo observado na pratica.
#
# Limites conhecidos (por isso a protecao de branch no GitHub e a camada que
# vale para todo mundo): comando embrulhado em script nao contem "git push" no
# texto; a extracao sem jq (nem toda maquina tem) e textual.
#
# LIMITE PRATICO, com contorno: o guard nao distingue CODIGO de DADO. Um
# heredoc cuja MENSAGEM menciona o fluxo ("git checkout main && git push") e
# lido como se fossem comandos, e o commit e recusado. Aspas sao removidas
# antes da analise, mas heredoc nao e aspa. Contorno: escreva a mensagem em
# arquivo e use `git commit -F <arquivo>` — o texto sai do comando.
# =============================================================================
set -uo pipefail
set -f  # sem globbing: vamos iterar tokens do comando

input=$(cat 2>/dev/null || echo '{}')

# De ONDE olhar a branch. Ordem: o `cwd` que o proprio hook recebe no JSON, e so
# depois CLAUDE_PROJECT_DIR.
#
# POR QUE NAO CLAUDE_PROJECT_DIR PRIMEIRO: numa sessao isolada em worktree o
# Claude Code aponta CLAUDE_PROJECT_DIR para o CHECKOUT PRINCIPAL, nao para o
# worktree. Como o principal fica na `main`, o guard lia branch `main` e recusava
# TODO commit vindo de qualquer worktree, em qualquer branch — falso positivo
# reproduzido em 17/08 ("BLOQUEADO: commit na branch principal (main)" estando em
# chore/worktree-obrigatorio). Com R-GIT-2 (uma sessao = um worktree) isso deixa
# de ser caso de canto e vira o caminho normal.
cwd_hook=$(printf '%s' "$input" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\(\([^"\\]\|\\.\)*\)".*/\1/p' | head -n1)
cwd_hook=$(printf '%s' "$cwd_hook" | sed 's/\\\\/\\/g')
for d in "$cwd_hook" "${CLAUDE_PROJECT_DIR:-}"; do
  if [ -n "$d" ] && [ -d "$d" ]; then
    cd "$d" 2>/dev/null && break
  fi
done
# Extrai tool_input.command sem jq. O padrao atravessa aspas escapadas (\")
# dentro do comando; \n vira texto literal, tratado abaixo.
comando=$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(\([^"\\]\|\\.\)*\)".*/\1/p' | head -n1)
[ -z "${comando:-}" ] && exit 0

# Texto CITADO nao e comando: um `gh pr create --body "...git push origin main..."`
# MENCIONA push sem EXECUTAR push. Remove conteudo entre aspas (no JSON a aspa
# dupla interna chega como \") antes de qualquer analise. Comando real de push
# nao precisa de aspas no refspec; se usar ('git push origin "main"'), quem
# segura sao as camadas de ESTADO (.githooks/pre-push e o GitHub) — limite
# textual declarado.
comando_raw="$comando"
comando=$(printf '%s' "$comando" | sed -e 's/\\"\([^"\\]\|\\[^"]\)*\\"/ QUOTED /g' -e "s/'[^']*'/ QUOTED /g")

case "$comando" in
  *"git push"*|*"git commit"*) ;;
  *) exit 0 ;;
esac

bloquear() {
  {
    echo "BLOQUEADO: $1"
    echo "Toda mudanca entra na main por Pull Request. Fluxo correto:"
    echo "  git checkout -b feat/<area>/<slug>"
    echo "  # edits + commits"
    echo "  git push -u origin feat/<area>/<slug>"
    echo "  gh pr create --base main --title \"...\" --body \"...\""
  } >&2
  exit 2
}

# Estado ANTES da execucao. `git checkout main` no meio do proprio comando muda
# esse estado para os segmentos seguintes — tratado dentro do laco.
#
# Worktree-aware: se o comando faz `cd <dir>`, a branch que importa e a DESSE
# diretorio. git worktrees mantem branches distintas por diretorio; sem isto um
# commit/push legitimo numa feature/release branch de um worktree isolado seria
# bloqueado so porque o worktree principal (CLAUDE_PROJECT_DIR) esta na main.
# Nao enfraquece: `cd <worktree-na-main> && git commit` continua bloqueado,
# pois a deteccao passa a olhar a branch REAL do diretorio alvo.
#
# O DIRETORIO DO `cd` SAI DE UMA COPIA A PARTE (comando_cd), nao do $comando ja
# higienizado. Motivo: a limpeza de aspas troca todo trecho citado por " QUOTED ",
# entao `cd "<raiz>/.claude/worktrees/x"` chegava aqui como `cd QUOTED` — diretorio
# inexistente, o guard caia na branch do checkout PRINCIPAL e recusava push
# legitimo de worktree. Medido em 20/08/2026, release v0.7.329: o push da tag de
# dentro do worktree foi recusado com "push a partir da branch principal (main)",
# mensagem que nao aponta para a causa. Sem aspas passava; com aspas, nunca — e
# caminho COM ESPACO nao tinha saida, porque o token cru para no primeiro espaco.
#
# A copia desfaz as aspas SO do argumento do `cd` (a forma sintatica `cd "..."` /
# `cd '...'`) e so DEPOIS aplica a limpeza geral. Um `cd` que aparece DENTRO de
# uma mensagem (`git commit -m "veja cd /x"`) nao esta nessa forma: continua
# virando QUOTED e NAO e considerado — a regra "texto citado nao e comando" fica
# inteira. Os espacos do caminho viram @@ESP@@ na ida e voltam na volta.
comando_cd=$(printf '%s' "$comando_raw" | sed 's/\\"/"/g')
comando_cd=$(printf '%s' "$comando_cd" | sed -e ':a' -e 's/\(cd[[:space:]]\{1,\}"[^" ]*\) \([^"]*"\)/\1@@ESP@@\2/' -e 'ta')
comando_cd=$(printf '%s' "$comando_cd" | sed -e ':b' -e "s/\(cd[[:space:]]\{1,\}'[^' ]*\) \([^']*'\)/\1@@ESP@@\2/" -e 'tb')
comando_cd=$(printf '%s' "$comando_cd" | sed -e 's/cd\([[:space:]]\{1,\}\)"\([^"]*\)"/cd\1\2/g' -e "s/cd\([[:space:]]\{1,\}\)'\([^']*\)'/cd\1\2/g")
comando_cd=$(printf '%s' "$comando_cd" | sed -e 's/"[^"]*"/ QUOTED /g' -e "s/'[^']*'/ QUOTED /g")
gwd=$(printf '%s' "$comando_cd" | sed 's/\\[ntr]/\n/g' | grep -oE '(^|[;&| ])cd[[:space:]]+[^ ;&|]+' | tail -n1 | sed -E 's/.*cd[[:space:]]+//' | sed 's/@@ESP@@/ /g')
if [ -n "${gwd:-}" ] && [ -d "$gwd" ]; then
  branch=$(git -C "$gwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
else
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
fi
na_principal=0
case "$branch" in
  main|master) na_principal=1 ;;
esac

# Segmentacao: cada `&&`, `||`, `;`, `|` e nova linha (\n/\t/\r literais do
# JSON) inicia um comando novo. Sem isso, tokens de UM comando contaminam a
# analise de OUTRO na mesma linha.
segmentos=$(printf '%s' "$comando" | sed -e 's/\\[ntr]/\n/g' -e 's/&&/\n/g' -e 's/||/\n/g' -e 's/;/\n/g' -e 's/|/\n/g')

while IFS= read -r seg; do
  case "$seg" in
    *"git push"*)
      # --- 1) push que MIRA a principal, de qualquer branch ---------------
      for w in $seg; do
        case "$w" in
          main|master|+main|+master|*:main|*:master|refs/heads/main|refs/heads/master|*:refs/heads/main|*:refs/heads/master)
            bloquear "push mirando a branch principal ('$w')." ;;
        esac
      done
      # --- 2) estando NA principal ----------------------------------------
      # So passa push que mira EXPLICITAMENTE uma feature branch (prefixos
      # que o repo usa).
      if [ "$na_principal" = 1 ]; then
        case "$seg" in
          *origin*feat/*|*origin*fix/*|*origin*chore/*|*origin*docs/*|\
          *origin*refactor/*|*origin*test/*|*origin*hotfix/*)
            : ;;
          *)
            bloquear "push a partir da branch principal ($branch)." ;;
        esac
      fi
      ;;
  esac

  case "$seg" in
    *"git commit-tree"*)
      # plumbing: cria objeto commit sem mover ref nenhuma — nao e commit na main
      : ;;
    *"git commit"*)
      if [ "$na_principal" = 1 ]; then
        bloquear "commit na branch principal ($branch). Crie a feature branch ANTES de commitar."
      fi
      ;;
  esac

  # `git checkout main` / `git switch master` DENTRO do mesmo comando: o HEAD
  # lido acima e o de ANTES da execucao, entao sem isto um
  # `git checkout main && git push` escaparia da checagem de ESTADO.
  case "$seg" in
    *"git checkout"*|*"git switch"*)
      for w in $seg; do
        case "$w" in
          main|master) na_principal=1 ;;
        esac
      done
      ;;
  esac
done <<< "$segmentos"

exit 0
