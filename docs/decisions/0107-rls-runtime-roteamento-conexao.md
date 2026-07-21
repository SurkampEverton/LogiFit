# ADR 0107 — RLS em runtime: roteamento de conexão por request

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

A arquitetura de autorização ([`acesso-e-autorizacao.md`](../acesso-e-autorizacao.md)) define a RLS como camada 2, ativada por `set_config('app.tenant_id', ...)` na conexão. O `wrapServerAction` embrulha **toda** Server Action em `withSessionContext`, que fazia exatamente isso — e um comentário no próprio arquivo já confessava o problema:

> `// fn deve usar o mesmo client; mas Drizzle global pool sempre pega novo.`

O `set_config` era aplicado numa conexão do pool e as queries do Drizzle rodavam em **outra**, onde o contexto não existia. Consequência dupla:

1. **A RLS nunca aplicou em runtime.** Nenhuma policy filtrou nada em nenhuma request desde o Sprint 01a. O isolamento entre tenants dependeu exclusivamente de filtro explícito `tenant_id` em cada query.
2. **A promessa criou vazamentos.** Código escrito confiando no comentário do wrapper ("RLS via app.tenant_id") omitiu o filtro explícito — 8 casos corrigidos em 2026-07-20 (`62c1bf2`, `b015568`), incluindo listagem de empresas de 4 tenants numa tela e pessoas de qualquer tenant acessíveis por UUID.

Agravante descoberto na mesma investigação: o pool conecta como **superusuário** (dev self-host), e superusuário atravessa qualquer policy — `FORCE ROW LEVEL SECURITY` inclusive. Mesmo com a conexão certa, sem trocar de papel a RLS seguiria inerte.

## Decision

**Rotear o `db` global para a conexão contextualizada, por request, via `AsyncLocalStorage`** — e assumir o papel de aplicação na entrada do contexto.

### Mecanismo (`packages/db/src/client.ts`)

- `RoutedPool extends Pool`: `query()` e `connect()` consultam o AsyncLocalStorage; havendo conexão contextualizada, tudo vai para ela — inclusive o caminho de transação do Drizzle, que recebe a mesma conexão com `release()` neutralizado (quem devolve ao pool é o dono do contexto).
- `runWithDbClient(client, fn)`: abre o escopo. O `await` acontece **dentro** do escopo — query builder do Drizzle é thenable preguiçoso, e sem esse detalhe uma query devolvida sem `await` executaria após o fim do contexto, caindo no pool sem escopo, sem erro nenhum.
- Queries concorrentes na conexão contextualizada são serializadas por fila própria (`Promise.all` em handler é padrão comum; o enfileiramento interno do pg está deprecado).

### Contextos (`apps/web/app/lib/*`)

`withSessionContext`, `withMemberContext` e `withPassportContext` agora: `SET ROLE logifit_app` → `set_config` (tenant/user/permissions/role conforme o contexto) → `runWithDbClient(client, fn)` → limpeza (`RESET ROLE` + configs vazios) antes de devolver ao pool. Falha no `SET ROLE` loga erro alto e prossegue — os filtros explícitos seguram, mas nunca em silêncio.

### O que NÃO muda

- **Filtros explícitos de `tenant_id` continuam obrigatórios.** A RLS vira o que sempre deveria ter sido: defesa em profundidade, não única linha. Query nova sem filtro explícito continua errada.
- Caminhos de sistema (webhook Focus, jobs, `withSystemConnection`, `withElevatedContext`) seguem com conexão própria fora do roteamento.
- Fora de qualquer contexto, o `db` vai ao pool como antes — comportamento de sistema.

## Consequences

### Positivas

- RLS aplica de verdade em toda Server Action, sem mudar uma linha dos handlers.
- Validado por teste de integração (`client-routing.test.ts`): SELECT sem filtro dentro do contexto retorna só o tenant; transação roda na mesma conexão; contextos paralelos não se contaminam; nada vaza para fora do escopo.
- Suíte completa verde (932 testes @repo/db) + fumaça manual nas telas críticas com writes e audit.

### Negativas (aceitas)

- **Serialização por request**: queries de um mesmo contexto não paralelizam de verdade (uma conexão). Latência de `Promise.all` vira soma, não máximo. Aceitável no MVP; se doer, paraleliza-se checando N conexões contextualizadas.
- **Papel `logifit_app` precisa de GRANT em toda tabela nova** — já era exigência das policies (regra 1); agora a falta aparece em runtime, não só nos testes. É feature: GRANT esquecido era invisível.
- `SET ROLE` falho degrada para o modo antigo (só filtros explícitos) com log de erro — trade-off deliberado para não derrubar produção por config de papel.

## Referências

- [`acesso-e-autorizacao.md`](../acesso-e-autorizacao.md) — camada 2 (a que este ADR liga de fato)
- Regra 1 ([`rules.md`](../rules.md)) — toda tabela com `tenant_id` + RLS
- `packages/db/tests/client-routing.test.ts` — prova executável do mecanismo
