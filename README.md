# LogiFit

ERP SaaS B2B multi-tenant para Academia + Fisioterapia + Nutrição.

## Documentação

- [`CLAUDE.md`](CLAUDE.md) — contexto permanente do projeto (stack, regras, glossário, sprint ativo)
- [`docs/arquitetura.md`](docs/arquitetura.md) — visão geral da arquitetura
- [`docs/rules.md`](docs/rules.md) — 46 regras duras
- [`docs/roadmap.md`](docs/roadmap.md) — linha do tempo + sprints
- [`docs/decisions/`](docs/decisions/) — ADRs (decisões arquiteturais)

## Pré-requisitos (dev local)

- **Node 22+**
- **pnpm** (`npm i -g pnpm`)
- **Docker Desktop** (Postgres, Redis, MinIO, Mailhog, GlitchTip rodam em containers)
- **Git**

Sem necessidade de criar contas externas pra começar — Sprint 00 roda 100% local via `docker compose`. Hospedagem de produção é VPS único Oracle Cloud SP via Coolify ([ADR 0091](docs/decisions/0091-self-host-total-oracle-sp.md)).

## Comandos

Lista canônica. Sprint 00 vai materializando ao longo das 5 semanas — alguns dependem de Faixas 2-4 (Coolify, segurança, lints custom, suítes E2E).

```bash
pnpm dev:up           # docker compose up -d (Postgres + Redis + MinIO + Mailhog)
pnpm dev:down         # docker compose down
pnpm dev:reset        # drop volumes + recriar (uso em teste limpo)
pnpm dev              # Next.js em localhost:3000 (assume dev:up rodando)
pnpm test             # Vitest
pnpm test:e2e         # Playwright
pnpm test:smoke       # smoke suíte (<2min, roda em todo PR)
pnpm test:critical    # critical suíte (<8min, bloqueia deploy prod)
pnpm db:migrate       # Drizzle migrate
pnpm db:seed          # Seed dos 5 cenários canônicos
pnpm db:rls-check     # Falha se tabela sem RLS (regra 1+2)
pnpm i18n:check       # Falha se chave faltando em qualquer locale (regra 27)
pnpm docs:check       # Lint da documentação (slug ADR ≡ filename, links resolvem)
pnpm compliance:check # Hash RIPD + ADR esperado + threat model + ai_audit_log
pnpm lint             # Biome lint + format
pnpm typecheck        # tsc --noEmit
```

## Como testar

Estratégia completa em [ADR 0090](docs/decisions/0090-estrategia-de-testes.md). Resumo:

- **Smoke** (10 testes, <2min, todo PR): bloqueia merge
- **Critical** (12 testes, <8min, PR de release): bloqueia deploy prod
- **Regression / a11y / perf / external** (nightly ou schedule semanal)
- **Cobertura**: ≥80% em `packages/errors|security|db/policies` · ≥70% em `packages/db` · ≥60% em Server Actions

## Sprint ativo

Consulte [docs/roadmap.md](docs/roadmap.md) seção "Sprints ativos". Atualmente: **Sprint 00 — Setup de Infra** (planejado, +5 semanas — [docs/sprints/00-setup-infra.md](docs/sprints/00-setup-infra.md)).
