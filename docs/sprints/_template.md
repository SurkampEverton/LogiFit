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

## Stretch (se sobrar tempo)

- [ ] #issue — opcional

## Log diário (opcional; 1 linha por dia trabalhado)

- dd/mm — …

## Definition of Done (checklist)

- [ ] Feature flag criada (se feature nova)
- [ ] Testes unit + e2e verdes
- [ ] Teste RLS verificado (se mexeu em tabela)
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
