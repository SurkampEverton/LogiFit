# Sprint XX — Nome da funcionalidade

- **Início:** YYYY-MM-DD
- **Fim planejado:** YYYY-MM-DD (teto: 3 semanas)
- **Status:** planejado | doing | done | cancelado
- **Item do roadmap:** #N

## Goal (1 linha)

O que esta funcionalidade entrega, em uma frase.

## Critério de aceite

- …
- …
- …

## Dependências

- Sprint X (concluído)
- Item de backlog Y

## Decisões tomadas durante o sprint

- ADR NNNN — assunto (link)

## Commit (o que prometo a mim mesmo)

- [ ] #issue — descrição curta
- [ ] #issue — descrição curta

## Estratégia de testes ([ADR 0090](../decisions/0090-estrategia-de-testes.md))

Preencher antes de entrar em `doing`. Taxonomia T1-T21 + 3 níveis em ADR 0090.

**Categoria de risco** (escolher 1+ — define Obrigatórios extras pelo §7 do ADR):
- [ ] multi-tenant base · webhook provider · cálculo financeiro · parser documento · IA SaMD II+ · cross-tenant clínico · fiscal · clínico assinado · mobile-PWA · migração-infra · outro: ___

**Linha-base transversal** (default — só listar se ficar fora, com motivo): T1 T2 T3 T5 T6 T14 T16 T17 T19 T20

**Obrigatórios extras** (CI bloqueia merge se faltar):
- T-X — descrição curta do caso (fluxo / arquivo)
- …

**Recomendados aplicados** (entram no sprint):
- T-X — descrição curta
- …

**Recomendados em débito** (não cabem; viram issue `test-debt` rastreável):
- T-X — descrição + link da issue

**Opcionais avaliados** (justificar aplicar OU descartar — transparência):
- T-X — aplicado: motivo
- T-X — descartado: motivo

## Stretch (se sobrar tempo)

- [ ] #issue — opcional

## Log diário (opcional; 1 linha por dia trabalhado)

- dd/mm — …

## Definition of Done (checklist)

- [ ] Feature flag criada (se feature nova)
- [ ] **Testes ([ADR 0090](../decisions/0090-estrategia-de-testes.md)):** unit + integration + E2E `smoke/` verdes; Obrigatórios extras da categoria implementados (CI valida); Recomendados em débito têm issue `test-debt` criada; coverage gate respeitado — ≥80% em `errors|security|policies`, ≥70% em `packages/db`, ≥60% em Server Actions (regra 18)
- [ ] Teste RLS verificado (se mexeu em tabela) — `db:rls-check` estrutural + `twoConnectionsTest()` comportamental para isolamento real entre tenants (T6, ADR 0090)
- [ ] **Responsividade:** UI renderiza em mobile (390px) + tablet (768px) + desktop (1280px); testes visuais Playwright passam; zero overflow horizontal em mobile; touch targets ≥44px (ADR 0063, regra 31)
- [ ] **Busca global:** se criou tabela pesquisável, registrou em `search_index` com `required_permission` explícita (ADR 0062, regra 30)
- [ ] **i18n:** todas as strings de UI em `t('namespace.key')` com 3 locales (pt-BR/en-US/es-419); `pnpm i18n:check` passa (regra 27)
- [ ] Migrations Drizzle aplicadas e revisadas
- [ ] CHANGELOG.md atualizado
- [ ] docs/roadmap.md atualizado (status → done)
- [ ] ADR criado se houve decisão arquitetural
- [ ] Zero violação das regras em docs/rules.md
- [ ] Merge em main + tag de versão (se release)

## Retro (preencher no fim)

- **Entregue:** …
- **Escorregou:** … (vai para backlog ou próximo sprint?)
- **Aprendi:** …
- **Continuar:** …
- **Parar:** …
- **Começar:** …
