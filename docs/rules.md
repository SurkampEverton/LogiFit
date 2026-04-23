# Regras do Projeto LogiFit

Regras duras e inquebráveis. Divididas em 3 blocos. Violação = CI vermelho, revert, ou sprint não fecha.

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
