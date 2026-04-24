# Regras do Projeto LogiFit

Regras duras e inquebráveis. Divididas em 3 blocos + regras transversais (multi-empresa, i18n, IA, LGPD, pesquisa global). Violação = CI vermelho, revert, ou sprint não fecha.

> **Como usar:** toda discussão técnica começa perguntando "isso fere alguma regra?". Se sim, ou mudamos a regra (ADR) ou mudamos a solução. Regras não são sugestões.

---

## Arquiteturais (quebrou = revert + ADR justificando)

**1.** Toda tabela de negócio tem `tenant_id uuid not null` + RLS policy usando `(auth.jwt() ->> 'tenant_id')::uuid`.
**2.** CI tem teste que *falha* se encontrar tabela nova sem RLS habilitada.
**3.** Drizzle é a única fonte do schema — tipos do Supabase CLI desligados.
**4.** Dados sensíveis (prontuário, mídia clínica, avaliação) criptografados at-rest.
**5.** `audit_log` é append-only, particionado por mês; nunca sofre `UPDATE`/`DELETE`.
**6.** Cross-module exige consentimento explícito em `consents` — testado no CI.
**7.** Todo boundary (Server Action, API Route, webhook) valida entrada com **Zod**.
**8.** Webhooks externos são idempotentes via coluna `external_id` unique em `webhook_events`.

**21.** `companies` tem `type ∈ {matriz, filial}`; exatamente **1 matriz por tenant** (enforced por trigger/constraint).
**22.** `companies.cnpj` é unique **global** (no sistema inteiro), não por tenant — evita cadastro duplicado entre redes.
**23.** Dado fiscal (NF-e, recibo, contrato) **nunca** perde `company_id` — é o CNPJ emissor.
**24.** Transferência de aluno entre filiais = `UPDATE members SET company_id = X` + registro em `audit_log`; nunca deletar/recriar.
**25.** Dados clínicos sensíveis (prontuário, mídia, avaliação) **nunca cruzam `company_id` quando `tenant.topology = 'franchise'`**. Nem com consent. Enforced por RLS + audit.
**26.** `groups` é camada apenas visual/agregada. Queries cross-tenant do mesmo group retornam **somente dados agregados** via views dedicadas. Nenhum `SELECT` direto em tabela operacional pode usar `group_id` como filtro cross-tenant. Teste de CI bloqueia.

**27.** **Proibido hardcode de string de UI.** Toda string visível ao usuário (botão, título, mensagem, placeholder, tooltip) vai via `t('namespace.key')` do next-intl. Message catalog obrigatório nos 3 locales (`pt-BR`, `en-US`, `es-419`). CI roda `pnpm i18n:check` e falha se faltar chave em qualquer locale. Exceção: nomes de entidades de domínio (ex: "Pollock 7 dobras"), códigos técnicos (CID, TUSS), nomes de features flags, strings de debug/log não-visíveis. Ver [ADR 0052](decisions/0052-i18n-tres-idiomas-pt-en-es.md).

**28.** **Feature IA classe SaMD II+ não ativa sem Comitê de IA cadastrado no tenant.** Feature flag é bloqueada por gate que consulta `ai_committee_members` — sem ao menos 1 membro ativo + ata de criação anexada, a feature não liga em produção, mesmo com flag ON. Toda chamada a feature IA clínica grava em `ai_audit_log` (input, output, modelo, versão do prompt, decisão humana: aceitou/editou/rejeitou). Classificador de output proibido ("diagnóstico", "tem [doença]", "prescrever") ativo em toda chamada. Violação = feature desligada automaticamente + alerta ao admin do tenant. Ver [ADR 0053](decisions/0053-conformidade-cfm-2454-2026-ia-saude.md) (CFM 2.454/2026 + classificação SaMD RDC 657/2022).

**29.** **Dado de saúde sensível (LGPD art. 11) só trafega com base legal explícita + RIPD vigente.** Todo módulo que processa `health_data` (prontuário, avaliação, exame, mídia clínica, device reading, plano alimentar, prescrição) tem entrada em `ripd_documents` com versão vigente (`ripd_versions`) assinada pelo DPO, revisada no máximo a cada 6 meses. Consent por finalidade (`consent_purposes.lawful_basis`) não pode ser genérico — cada finalidade lista `data_categories[]` e `retention_period` explícitos. CI tem teste que falha se um módulo clínico novo for criado sem registro em `ripd_documents`. Direitos do titular (art. 18) atendidos em até **15 dias** via portal `/meu/privacidade`. Ver [ADR 0054](decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md).

**30.** **Módulo novo com dado pesquisável deve registrar-se em `search_index`** via trigger `search_index_sync()` declarando explicitamente: `kind` (identificador do tipo), `label`/`subtitle`/`url` (o que mostrar), `searchable_text` (campos buscáveis), **`required_permission`** (permission mínima para aparecer no resultado), `required_vertical` (quando aplicável), `required_consent_purpose` (quando cross-module), `is_sensitive` (true → clique grava audit). Omissão de `required_permission` é proibido — operador sem permission nunca pode ver o resultado, nem "provocar" clique para descobrir existência. Ver [ADR 0062](decisions/0062-pesquisa-global-command-palette.md).

---

## Processo (quebrou = não fecha sprint)

**9.** 1 sprint ativo por vez. Teto de 3 semanas por sprint. Estourou? Quebra em duas funcionalidades menores.
**10.** Commits vão direto para `main` (desenvolvimento solo, sem PR review obrigatório). Branches `feat/*`, `fix/*`, `chore/*`, `docs/*` são **opcionais** — usar só quando a feature é longa, arriscada, ou o trabalho precisa ser testado isolado antes de merge.
**11.** Conventional Commits obrigatórios (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
**12.** Toda feature nova entra atrás de **feature flag** (PostHog) até ser validada.
**13.** ADR criado no **mesmo dia** da decisão; nunca retroativo.
**14.** `CHANGELOG.md` atualizado em todo commit que muda comportamento observável.
**15.** Nenhum `--no-verify`, `--force` em `main`, nem skip de CI.

---

## Código (quebrou = CI vermelho)

**16.** TypeScript `strict: true`. `any` só com comentário `// why:` justificando.
**17.** Biome formata e linta; sem override pessoal.
**18.** Cobertura mínima: 70% em `packages/db`, 60% em Server Actions.
**19.** Nenhum segredo em código — `.env` + Vercel/Supabase secrets.
**20.** Import ordenado por Biome; caminhos absolutos `@repo/*`.

---

## Exceções

Qualquer exceção a uma regra exige:

1. ADR novo justificando (com data + contexto + consequência)
2. Link do ADR no PR que quebra a regra
3. Atualização desta página mencionando a exceção (ou a revisão da regra)

Sem ADR, sem merge.
