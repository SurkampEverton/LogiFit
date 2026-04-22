<!--
  Checklist de PR do LogiFit — segue as regras em docs/rules.md
  Preencha o que se aplica; marque N/A no resto.
-->

## Sprint / Issue

- Sprint: #
- Fecha issue: #
- Funcionalidade no roadmap: #

## O que muda (por quê, não o que)

<!-- 2–4 linhas explicando o porquê da mudança. O diff mostra o "o que". -->

## Tipo de mudança

- [ ] `feat` — feature nova
- [ ] `fix` — bug fix
- [ ] `refactor` — reestruturação sem mudar comportamento
- [ ] `docs` — só documentação
- [ ] `test` — só testes
- [ ] `chore` — build, infra, sem mudança em produto

## Checklist de Definition of Done

<!-- Marcar todos os aplicáveis. Se um item não se aplica, marcar e adicionar "— N/A: motivo" -->

- [ ] Testes unit + e2e verdes
- [ ] **RLS verificada** (se mexeu em tabela com `tenant_id`) — testei nos 4 cenários canônicos?
- [ ] Migration Drizzle revisada (reversível, sem bloqueio longo de tabela)
- [ ] Feature flag criada se feature nova (PostHog)
- [ ] CHANGELOG.md atualizado (se mudou comportamento observável)
- [ ] ADR criado se houve decisão arquitetural
- [ ] Zod schema no boundary (Server Action / API Route / webhook)
- [ ] Audit log registrando se mexeu em dado sensível
- [ ] Zero violação das regras em `docs/rules.md`
- [ ] Sem `any` sem `// why:`

## Risco e reversibilidade

- **Reversível por revert do PR?** sim / não (se não, explicar migração reversa)
- **Afeta dado em produção?** sim / não
- **Precisa feature flag ligada em fase?** sim / não

## Como testei

<!-- passos manuais / screenshots / logs de teste -->
