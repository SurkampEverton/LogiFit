#!/usr/bin/env bash
# =============================================================================
# PreToolUse(Edit|Write|NotebookEdit) - Claude Code
# Recusa edicao de arquivo que esteja no CHECKOUT PRINCIPAL do repo.
#
# POR QUE: o PR isola no MERGE, nao na EDICAO. Varias sessoes no mesmo diretorio
# compartilham uma arvore de trabalho e um unico .git/index — a sessao A edita,
# a sessao B roda `git add`, e B leva a edicao de A junto.
#
# A saida e' uma sessao por worktree (CLAUDE.md > R-GIT-2).
#
# DECISAO, em ordem:
#   1) Fora de repo git            -> nao e' assunto nosso, passa.
#   2) Dentro de worktree          -> passa (e a partir dai a isolacao NATIVA do
#      Claude Code assume: ela bloqueia escrita de volta no principal por conta
#      propria, com 4 checagens que este hook nao precisa repetir).
#   3) No checkout principal       -> allowlist e escape hatch, senao DENY.
#
# COMO DISTINGUIR (sem heuristica, comparacao de string):
#   git rev-parse --path-format=absolute --git-dir
#   git rev-parse --path-format=absolute --git-common-dir
# No checkout principal os dois devolvem <repo>/.git. Dentro de um worktree o
# primeiro vira <repo>/.git/worktrees/<nome> e eles divergem.
# `--path-format` exige git >= 2.31 (git antigo cai no caso abaixo). Sem ele, sai 0 e passa —
# um guard que nao consegue decidir nao inventa uma decisao.
#
# LIMITES CONHECIDOS (declarados, nao contornados):
#   - Cobre Edit/Write/NotebookEdit. NAO cobre escrita por Bash (`sed -i`,
#     redirecionamento `>`). Para isso o que vale e' a isolacao nativa citada
#     acima, que so liga com a sessao DENTRO de um worktree.
#   - Vale so dentro do Claude Code. Terminal cru passa direto. A camada que
#     ninguem contorna continua sendo a protecao de branch no GitHub.
#   - Extracao do JSON e' textual: nem toda maquina tem `jq` (mesmo motivo
#     documentado em scripts/hooks/pre-push-guard.sh).
# =============================================================================
set -uo pipefail

input=$(cat 2>/dev/null || echo '{}')

# Edit/Write usam "file_path"; NotebookEdit usa "notebook_path". O padrao
# atravessa aspas escapadas (\") dentro do valor.
extrai() {
  printf '%s' "$input" |
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\(\([^\"\\\\]\|\\\\.\)*\)\".*/\1/p" |
    head -n1
}

alvo=$(extrai file_path)
[ -z "${alvo:-}" ] && alvo=$(extrai notebook_path)
[ -z "${alvo:-}" ] && exit 0

# No Windows o caminho chega com barra invertida escapada no JSON. Desescapa e
# normaliza para barra normal — o resto do script compara so nesse formato.
alvo=$(printf '%s' "$alvo" | sed 's/\\\\/\\/g' | tr '\\' '/')

# Arquivo novo pode estar em pasta que ainda nao existe: sobe ate achar uma que
# exista, senao o `git -C` falha e o guard passa quando deveria barrar.
dir=$(dirname "$alvo")
while [ ! -d "$dir" ]; do
  pai=$(dirname "$dir")
  [ "$pai" = "$dir" ] && break
  dir=$pai
done
[ -d "$dir" ] || exit 0

gitdir=$(git -C "$dir" rev-parse --path-format=absolute --git-dir 2>/dev/null || echo "")
common=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")

# Fora de repo, ou git velho demais para --path-format: nao decide, passa.
[ -z "$gitdir" ] || [ -z "$common" ] && exit 0

# Divergiram = worktree. Passa.
[ "$gitdir" != "$common" ] && exit 0

# --- Daqui para baixo: o alvo esta no CHECKOUT PRINCIPAL ---------------------

# Escape hatch da sessao de integracao/merge. De proposito e' variavel de
# ambiente e nao flag em arquivo: morre quando o terminal fecha, entao nao vira
# permissao permanente por esquecimento.
[ -n "${ERP_MAIN_OK:-}" ] && exit 0

# Allowlist: a configuracao do proprio guard e as regras moram no principal.
# Sem isto o hook impede a propria manutencao.
top=$(git -C "$dir" rev-parse --path-format=absolute --show-toplevel 2>/dev/null | tr '\\' '/')
rel=""
if [ -n "$top" ]; then
  alvo_l=$(printf '%s' "$alvo" | tr 'A-Z' 'a-z')
  top_l=$(printf '%s' "$top" | tr 'A-Z' 'a-z')
  case "$alvo_l" in
    "$top_l"/*) rel=$(printf '%s' "${alvo:$(( ${#top} + 1 ))}" | tr 'A-Z' 'a-z') ;;
  esac
fi

case "$rel" in
  claude.md|.claude/*|.githooks/*|scripts/hooks/*) exit 0 ;;
esac

# DENY. O motivo tem de ENSINAR a saida — um bloqueio que so diz "nao" faz a
# sessao tentar de novo de outro jeito.
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Edicao BLOQUEADA: '"$rel"' esta no CHECKOUT PRINCIPAL, que e somente-integracao. Uma sessao = um worktree. Saida: chame EnterWorktree, ou crie o worktree com `git worktree add .claude/worktrees/<slug> -b feat/<area>/<slug> origin/main` e trabalhe la. Se esta e a sessao de integracao/merge, rode com ERP_MAIN_OK=1. Regra: CLAUDE.md > R-GIT-2 (uma sessao = um worktree)."}}'

exit 0
