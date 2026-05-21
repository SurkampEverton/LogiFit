# LogiFit

ERP SaaS B2B multi-tenant para **Academia + Fisioterapia + Nutrição**, desenvolvido em modo solo. Dados de saúde sensíveis (LGPD art. 11) e profissionais regulados (CFM, CRN, CREFITO, CONFEF) — arquitetura robusta em isolamento de tenant, auditoria, criptografia e assinatura de prontuário desde o dia 1.

## Documentação

- [`CLAUDE.md`](CLAUDE.md) — contexto permanente do projeto (stack, regras, glossário, sprint ativo)
- [`docs/arquitetura.md`](docs/arquitetura.md) — visão geral da arquitetura
- [`docs/rules.md`](docs/rules.md) — 46 regras duras
- [`docs/roadmap.md`](docs/roadmap.md) — linha do tempo + sprints
- [`docs/decisions/`](docs/decisions/) — ADRs (decisões arquiteturais)
- [`docs/runbooks/`](docs/runbooks/) — procedimentos operacionais
- [`docs/compliance/`](docs/compliance/) — RIPDs LGPD + DPO + classificação SaMD

## Pré-requisitos (dev local)

- **Node 22+**
- **pnpm 10+** (`npm i -g pnpm`)
- **Docker Desktop** (Postgres, Redis, MinIO, Mailhog rodam em containers)
- **Git**

Sem necessidade de criar contas externas pra começar. Hospedagem de produção é VPS único Oracle Cloud Vinhedo via Coolify ([ADR 0091](docs/decisions/0091-self-host-total-oracle-sp.md)).

## Quick start

```bash
# 1. Subir infra local
pnpm install
pnpm dev:up           # docker compose up -d (Postgres + Redis + MinIO + Mailhog)

# 2. Aplicar migrations + seeds
pnpm db:migrate
pnpm db:seed          # 5 cenários canônicos (rede própria / franquia / passport / mix / solo)

# 3. Ativar pre-commit hooks (uma vez)
pnpm hooks:install    # git config core.hooksPath .githooks

# 4. Subir o app
pnpm dev              # Next.js em localhost:3000
```

## Comandos comuns

### Dev local
```bash
pnpm dev:up           # docker compose up -d
pnpm dev:down         # docker compose down
pnpm dev:reset        # drop volumes + recriar (teste limpo)
pnpm dev              # Next.js localhost:3000
pnpm dev:logs         # logs dos containers
```

### Banco
```bash
pnpm db:migrate       # Drizzle migrate
pnpm db:generate      # gera migration nova a partir do diff schema
pnpm db:seed          # 5 cenários canônicos
pnpm db:rls-check     # falha se tabela sem RLS (regra 1+2)
pnpm storage:bootstrap # cria buckets MinIO canônicos
```

### Testes
```bash
pnpm test             # Vitest unit + integration
pnpm test:e2e         # Playwright (todos)
pnpm test:smoke       # smoke suíte (<2min, todo PR)
pnpm test:critical    # critical suíte (<8min, PR de release)
```

### Qualidade
```bash
pnpm lint             # Biome lint + format
pnpm lint:fix         # autofix Biome
pnpm lint:custom      # 8 lints custom (regra 33/35/37/38/41/42/43/44/45/46)
pnpm typecheck        # tsc --noEmit em todos packages
pnpm i18n:check       # paridade catalogs nos 3 locales (regra 27)
pnpm i18n:extract     # lista chaves usadas via grep
pnpm docs:check       # links resolvem + ADR slug ≡ filename
pnpm compliance:check # hash RIPD + ADR esperado + threat model + ai_audit_log
pnpm hash:ripd        # SHA-256 RIPD frontmatter
```

### Release
```bash
pnpm sbom:generate    # SBOM CycloneDX em sboms/v<version>.json
```

## Como testar

Estratégia completa em [ADR 0090](docs/decisions/0090-estrategia-de-testes.md). Resumo:

- **Smoke** (10 testes, <2min, todo PR): bloqueia merge
- **Critical** (12 testes, <8min, PR de release): bloqueia deploy prod
- **Regression / a11y / perf / external** (nightly ou schedule semanal)
- **Cobertura**: ≥80% em `packages/errors|security|db/policies|storage|email` · ≥70% em `packages/db` · ≥60% baseline em `@repo/ai`

## Estrutura do monorepo

```
apps/
  web/              # Next.js 15 (único app no MVP)
packages/
  ai/               # Vercel AI SDK wrappers + cache semântico + classifier + agents
  auth/             # MFA, sessões, RBAC
  cnpj/             # provider abstrato BrasilAPI/ReceitaWS (ADR 0048)
  config/           # tsconfig base, biome.json, vitest base
  db/               # Drizzle schemas, migrations, RLS policies em SQL puro
  email/            # Brevo provider + MockEmailProvider test (ADR 0096)
  errors/           # envelope ADR 0071 + wrappers + sanitize LGPD + pino logger
  i18n/             # next-intl config + LOCALE_NAMES (ADR 0052)
  notifications/    # WhatsApp BSP wrapper
  security/         # safeFetch, scanUpload, rate limit Redis, MFA gates
  storage/          # MinIO adapter (interface estável p/ ADR 0091)
  types/            # schemas Zod compartilhados
  ui/               # shadcn custom + tokens Equilíbrio Vital + messages + responsive
```

## Sprint ativo

Consulte [docs/roadmap.md](docs/roadmap.md) — seção "Sprints ativos". MVP + Fase 2 + Fase 3 backbones entregues. Trabalho corrente: hardening + faixas b/c.

## Convenções de commit

[Conventional Commits](https://www.conventionalcommits.org/) obrigatório (regra 11):

```
feat: <novo recurso>
fix: <correção>
docs: <documentação>
chore: <manutenção>
refactor: <refactor sem mudança de comportamento>
test: <testes>
```

Commits vão direto em `main` (dev solo). Branches são opcionais para trabalho longo.
