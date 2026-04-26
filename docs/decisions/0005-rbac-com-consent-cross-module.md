# ADR 0005 — RBAC com scope + consent para acesso cross-module

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

Dentro do mesmo tenant convivem profissionais de áreas distintas (instrutor de academia, fisioterapeuta, nutricionista, recepção, admin). Dado clínico do fisio é sensível (LGPD art. 11, regulação CFM/CREFITO) e **não deve** ser visível por padrão para outros módulos, mesmo no mesmo tenant. Ao mesmo tempo, o diferencial do produto é **cruzar** esses dados (lesão registrada → alerta no treino) — o que exige autorização explícita.

## Decision

- **RBAC com scope** — `user_roles` tem `scope_type` (`group | tenant | company | unit`) + `scope_id`. Role sozinha não define o que o usuário vê; role + scope definem.
- **Permissões granulares** — tabela `permissions` com ações específicas (`prontuario.read`, `financeiro.write`, `copilot.use`, etc.). `role_permissions` liga.
- **Consent cross-module** — tabela `consents` guarda consentimento do paciente/aluno para compartilhar dado de módulo A com módulo B, com escopo e validade.
- **RLS verifica ambos** — policy em `prontuarios` só libera leitura se (a) role tem permission `prontuario.read` no scope e (b) se o leitor é de outro módulo, há consent ativo.
- **Dado clínico nunca cruza `company_id`** quando `tenant.topology = 'franchise'`, nem com consent (regulatório).
- **Audit log** registra toda leitura/escrita de dado sensível, incluindo qual consent foi usado.

## Consequences

- Modelo poderoso e fiel ao requisito regulatório, mas complexo. Testes de RLS nos 5 cenários canônicos viram parte do CI desde o início.
- Onboarding de cliente: fluxo de consentimento é obrigatório, não opcional. UX precisa ser clara.
- Performance: policies RLS com múltiplos joins (user_roles, consents) podem ficar lentas. Mitigado com views materializadas em casos pesados + índices corretos.
- Expansão para novos módulos é trivial — basta novo escopo de permission e nova categoria de consent.
