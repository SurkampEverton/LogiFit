# CLAUDE.md — Contexto permanente do projeto LogiFit

> Este arquivo é lido automaticamente em toda conversa com Claude Code neste repo. Mantém padrão sem precisar re-explicar.

## O que é

LogiFit é um ERP SaaS B2B multi-tenant para **Academia + Fisioterapia + Nutrição**, desenvolvido em modo **solo**. Lida com dados de saúde sensíveis (LGPD art. 11) e profissionais regulados (CFM, CRN, CREFITO). Arquitetura precisa ser robusta em isolamento de tenant, auditoria, criptografia e assinatura de prontuário desde o dia 1.

## Documentação de referência (leia antes de planejar)

- [`docs/arquitetura.md`](docs/arquitetura.md) — visão geral da arquitetura e stack
- [`docs/rules.md`](docs/rules.md) — **26 regras duras** (arquiteturais, processo, código)
- [`docs/modulos.md`](docs/modulos.md) — catálogo de módulos por área (fundação, geral, academia, fisio, nutri) + quais verticais usam
- [`docs/multiempresa.md`](docs/multiempresa.md) — hierarquia group → tenant → company → unit + flags de topology
- [`docs/acesso-e-autorizacao.md`](docs/acesso-e-autorizacao.md) — 4 camadas (identidade, tenant, RBAC, consent)
- [`docs/roadmap.md`](docs/roadmap.md) — linha do tempo + controle de evolução por sprint
- [`docs/sprints/`](docs/sprints/) — plano executável de cada sprint
- [`docs/decisions/`](docs/decisions/) — ADRs (por que decidimos assim)
- [`docs/comercial.md`](docs/comercial.md) — apresentação comercial (pitch para clientes/investidores; não é fonte técnica, só espelho em linguagem de venda)

## Regras que você (Claude) DEVE respeitar

1. **Nunca** crie tabela sem `tenant_id` + RLS.
2. **Nunca** use `any` sem comentário `// why:`.
3. **Sempre** valide boundary com Zod (Server Action, API Route, webhook).
4. **Sempre** verifique se há sprint ativo antes de sugerir trabalho fora de escopo (consultar `docs/sprints/` e `docs/roadmap.md`).
5. **Antes** de sugerir nova feature, confirmar com o usuário se cabe no sprint corrente ou vai para backlog.
6. **Se a decisão é arquitetural**, propor criar ADR em `docs/decisions/` no mesmo turno.
7. **Sempre** atualizar `CHANGELOG.md` quando mudar comportamento observável.
8. **Nunca** `git commit` sem o usuário pedir explicitamente.
9. **Nunca** `--force`, `--no-verify`, nem skip de CI.
10. **Respeitar Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`). Commits vão direto em `main` (dev solo); branches só para trabalho longo/arriscado.
11. **Nunca** escrever path absoluto (drive letter, `D:\...`, `/Users/...`, `~/...`) em doc versionada — repo é clonado em máquinas diferentes; usar sempre caminhos relativos a partir da raiz do repo.
12. **Nunca** hardcode string de UI em componente. Sempre via `t('namespace.key')` do next-intl com catálogo nos 3 locales (pt-BR/en-US/es-419). CI `pnpm i18n:check` falha se faltar chave. Ver [ADR 0052](docs/decisions/0052-i18n-tres-idiomas-pt-en-es.md) e regra 27 em `docs/rules.md`.

Lista completa em [`docs/rules.md`](docs/rules.md).

## Stack (fixa — mudanças exigem ADR)

- **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS v4, shadcn/ui, Zustand, TanStack Query, React Hook Form, Zod, **next-intl (i18n — pt-BR default + en-US + es-419)**
- **Backend:** Next.js server-side (Server Components + Server Actions + API Routes) — sem serviço separado
- **Banco/Auth/Realtime/Storage:** Supabase
- **ORM:** Drizzle (fonte única de schema)
- **IA:** Vercel AI SDK (Claude default; fallback OpenAI/Gemini) + cache semântico pgvector + rate limit Upstash Redis
- **Pagamentos:** Asaas
- **Email:** Resend
- **Observabilidade:** Sentry + PostHog + Logtail/Axiom
- **Qualidade:** Vitest + Playwright + GitHub Actions + Biome
- **Infra:** Vercel + Supabase

## Estrutura do monorepo

```
apps/
  web/              # Next.js 15 (único app no MVP)
packages/
  db/               # Drizzle schemas, migrations, RLS policies
  ui/               # shadcn custom + tokens "Equilíbrio Vital"
  ai/               # Vercel AI SDK wrappers + cache semântico
  types/            # Zod schemas compartilhados + tipos de eventos
  config/           # tsconfig base, biome.json
```

## Comandos comuns (Sprint 00 vai materializar)

```bash
pnpm dev              # Next.js em localhost:3000
pnpm test             # Vitest
pnpm test:e2e         # Playwright
pnpm db:migrate       # Drizzle migrate
pnpm db:seed          # Seed dos 4 cenários canônicos
pnpm db:rls-check     # Teste que falha se tabela sem RLS
pnpm lint             # Biome lint + format
pnpm typecheck        # tsc --noEmit
```

## Convenções

### Branches
- **Commits vão direto em `main`** (dev solo, sem PR review obrigatório)
- Branches `feat/sprint-XX-slug`, `fix/slug`, `chore/slug`, `docs/slug` são **opcionais** — usar só para trabalho longo, arriscado, ou que precisa ser testado isolado antes de merge

### Commits
- Conventional Commits obrigatório

### Arquivos
- TypeScript `strict: true`
- Imports absolutos: `@repo/db`, `@repo/ui`, `@repo/types`, `@repo/ai`
- Componentes em PascalCase, arquivos em kebab-case
- Server Actions retornam `{ ok: true, data } | { ok: false, error }`

### Testes
- Unit: Vitest, co-localizados (`.test.ts` ao lado do arquivo)
- E2E: Playwright em `apps/web/e2e/`
- RLS: script dedicado em `packages/db/tests/rls.test.ts`

## Hierarquia multi-empresa (essencial — leia `docs/multiempresa.md`)

```
group (opcional, sem CNPJ, só agregados)
 └── tenant (contrato SaaS, RLS raiz)
      └── company (matriz/filial, CNPJ, 1 matriz obrigatória)
           └── unit (local físico)
```

**Flags do tenant:** `topology` (`owned`/`franchise`), `financial_mode` (`centralized`/`distributed`), `cross_company_access` (bool).

**4 cenários canônicos obrigatórios no seed:** rede própria, franquia clássica, franquia com passaporte, mix loja avulsa + rede no mesmo group.

## Modelo de autorização (essencial — leia `docs/acesso-e-autorizacao.md`)

4 camadas: Identidade (Supabase Auth + MFA) → Tenant (RLS raiz) → RBAC com scope → Consent (cross-module / cross-company).

JWT claims custom: `tenant_id`, `scopes[]`, `group_ids[]`, `topology`, `mfa`.

## Sprint ativo

Consultar [`docs/roadmap.md`](docs/roadmap.md) — seção "Sprints ativos".

## Fora de escopo do MVP

- App nativo Expo (Fase 3)
- Generative UI (Fase 2)
- Módulo fiscal/NF-e (Fase 3 via Focus NFe)
- Fisioterapia e Nutrição (Fases 2 e 3)

## Como propor mudanças arquiteturais

1. Escrever ADR em `docs/decisions/NNNN-slug.md` com Context / Decision / Consequences / Status / Date
2. Linkar ADR no PR que introduz a mudança
3. Atualizar `docs/rules.md` se alterar uma regra
4. Atualizar `CHANGELOG.md`
5. Discutir com usuário antes de implementar

## Estilo de trabalho preferido

- Respostas concisas e diretas; sem narrar processo de pensamento
- Propor antes de executar quando a decisão é reversível com custo
- Executar direto quando o pedido é claro e a ação é reversível sem custo
- Usar TodoWrite para tarefas multi-passos
- Não criar arquivos `.md` fora do necessário; não adicionar comentários explicando o óbvio
- Mostrar caminhos relativos nos links markdown para facilitar navegação
