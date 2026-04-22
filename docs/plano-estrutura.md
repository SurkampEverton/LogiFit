# Plano: Estrutura de Planejamento e Desenvolvimento — LogiFit

## Context

LogiFit é um ERP SaaS B2B multi-tenant para Academia + Fisioterapia + Nutrição, greenfield em `D:\Projeto\LogiFit`. O repositório hoje tem apenas `README.md` e `docs/arquitetura.md` (copiado do plano original).

O usuário pediu a estrutura de planejamento e desenvolvimento do projeto. Durante a conversa, as decisões a seguir foram firmadas e precisam ser materializadas em documentação versionada:

- **Desenvolvimento solo** — processo enxuto, sem cerimônia vazia, mas com regras rígidas para evitar débito em sistema regulado (saúde/LGPD)
- **Sprints por funcionalidade** — escopo fechado ponta-a-ponta, teto 3 semanas, 1 sprint ativo por vez
- **Hierarquia de 4 níveis** — `group` (organizacional, sem CNPJ) → `tenant` (contrato SaaS) → `company` (matriz/filial com CNPJ) → `unit` (local físico)
- **Topology híbrida** — tenant suporta `owned` (rede própria) ou `franchise` (franquia); flags `financial_mode` (`centralized`/`distributed`) e `cross_company_access` (boolean)
- **Billing por tenant** — grupo não cobra; cada tenant é um contrato
- **Acesso cross-tenant do dono do grupo** — exige role explícito em cada tenant; ver grupo só dá agregados

Intenção: criar um pacote de documentação que sirva como espinha dorsal do projeto (regras arquiteturais, modelo de acesso, fluxo de sprints, roadmap, ADRs) e um `CLAUDE.md` para que futuras conversas com Claude Code respeitem automaticamente as regras sem precisar re-explicar.

---

## Árvore final de artefatos a criar

```
D:\Projeto\LogiFit\
├── CHANGELOG.md                                  # novo
├── CLAUDE.md                                     # novo — contexto para Claude Code
├── README.md                                     # manter
├── .github/
│   └── pull_request_template.md                  # novo
└── docs/
    ├── arquitetura.md                            # existe — atualizar (group/company/unit + flags)
    ├── plano-estrutura.md                        # novo — cópia deste plano (histórico)
    ├── rules.md                                  # novo — 26 regras
    ├── acesso-e-autorizacao.md                   # novo — 4 camadas + scope
    ├── multiempresa.md                           # novo — group/tenant/company/unit + 3 cenários
    ├── roadmap.md                                # novo
    ├── sprints/
    │   ├── _template.md                          # novo
    │   ├── 00-setup-infra.md                     # novo
    │   ├── 01a-identidade-e-topology.md          # novo
    │   └── 01b-rbac-e-consent.md                 # novo
    └── decisions/
        ├── 0001-stack-base.md                    # novo
        ├── 0002-rls-como-isolamento-primario.md  # novo
        ├── 0003-escopo-mvp-uma-vertical.md       # novo
        ├── 0004-drizzle-fonte-unica-schema.md    # novo
        ├── 0005-rbac-com-consent-cross-module.md # novo
        ├── 0006-hierarquia-group-tenant-company-unit.md  # novo
        ├── 0007-topology-owned-vs-franchise.md   # novo
        ├── 0008-group-como-camada-agregada.md    # novo
        └── 0009-loja-avulsa-nao-vira-nivel-proprio.md  # novo
```

---

## Conteúdo de cada arquivo (resumo executivo)

### `CLAUDE.md` (raiz)
Contexto permanente para Claude Code em conversas futuras:
- Stack (Next.js 15, Supabase, Drizzle, Tailwind v4, shadcn, TS strict, Biome)
- Estrutura do monorepo (`apps/web`, `packages/db`, `packages/ui`, `packages/ai`, `packages/types`)
- Referência a `docs/rules.md` como fonte das regras duras
- Comandos comuns (`pnpm dev`, `pnpm test`, `pnpm db:migrate`, `pnpm db:rls-check`)
- Convenções de código, de branch, de commit
- Regra: sempre consultar `docs/sprints/` para saber qual funcionalidade está ativa

### `docs/rules.md` — 26 regras
Três blocos: **Arquiteturais** (1–8, 21–26), **Processo** (9–15), **Código** (16–20). Detalhadas na conversa. Incluem: `tenant_id` + RLS em toda tabela, Drizzle único fonte do schema, Zod em todo boundary, webhooks idempotentes, audit_log append-only, 1 sprint ativo, Conventional Commits, TS strict, companies têm 1 matriz por tenant, CNPJ único global, dado clínico nunca cruza franchise, groups só agregados.

### `docs/acesso-e-autorizacao.md`
- Diagrama das 4 camadas: Identidade → Tenant → RBAC (com scope) → Consent
- JWT claims: `tenant_id`, `scopes[]`, `group_ids[]` (opcional)
- Exemplos de RLS multi-nível
- Tabela de roles × scopes (super_admin, diretor_rede, gerente_filial, recepcao, fisio, nutri, instrutor, aluno, group_owner)
- MFA obrigatório para profissionais
- Sessão multi-device, revogação
- Fluxo de login contextual (escolher tenant ativo quando user tem múltiplos)

### `docs/multiempresa.md`
- Diagrama group/tenant/company/unit
- Tabela comparativa dos 4 níveis (jurídica? RLS? dado sensível?)
- Flags do tenant: `topology`, `financial_mode`, `cross_company_access`
- **4 cenários canônicos obrigatórios no seed:**
  1. Rede própria (`owned` + `distributed` + `cross=true`) — matriz + filiais com CNPJ
  2. Franquia clássica (`franchise` + `distributed` + `cross=false`) — franquias isoladas
  3. Franquia com passaporte (`franchise` + `distributed` + `cross=true`) — com `franchise_agreements`
  4. **Mix no mesmo grupo** — `group` agregando 1 tenant de loja avulsa (1 company-matriz + 1 unit) + 1 tenant de rede (N companies + M units); dono vê dashboard consolidado sem vazar dado individual
- **Loja avulsa é a própria matriz** — matriz é obrigatória, filial é opcional; loja avulsa = 1 company `type=matriz` + 1 unit, sem filial; constraint no banco garante exatamente 1 matriz por tenant
- **Árvore de decisão: várias lojas do mesmo dono** — 1 tenant com N companies (se alunos/agenda/operação integrados) vs N tenants no mesmo group (se negócios independentes); padrão conservador é separar em tenants (mais fácil unir no futuro do que dividir)
- Regras de mobilidade do aluno entre units/companies (dentro do mesmo tenant, nunca cross-tenant mesmo do mesmo group)
- `franchise_agreements` quando aplicável
- Views agregadas para group (`group_metrics`) sem vazar dado individual
- **Troca de contexto de tenant**: fluxo de login contextual para dono do grupo (role `group_owner` vê agregados; para operar, entra em um tenant específico com role explícito; JWT é reassinado com `tenant_id` do contexto escolhido)

### `docs/roadmap.md`
Tabela: Funcionalidade | Módulo | Fase | Sprint alvo | Status | Dependências.
Entradas pré-preenchidas cobrindo MVP (Academia), Fase 2 (Fisio), Fase 3 (Nutri+App).

### `docs/sprints/_template.md`
Formato solo sprint-por-funcionalidade: Goal, Critério de aceite, Dependências, Decisões tomadas (link ADR), Log diário opcional, DoD checklist, Retro.

### `docs/sprints/00-setup-infra.md`
Monorepo Turborepo+pnpm, Supabase local, Drizzle, tokens "Equilíbrio Vital", CI (type-check, biome, vitest, drizzle migrate, teste RLS), observabilidade (Sentry+PostHog).

### `docs/sprints/01a-identidade-e-topology.md`
Auth + MFA, `groups`, `tenants` com flags, `companies` (matriz/filial, constraint 1-matriz-por-tenant), `units`, JWT com custom claims, RLS nível tenant, seed dos 4 cenários canônicos (incluindo "loja avulsa + rede no mesmo group").

### `docs/sprints/01b-rbac-e-consent.md`
`roles`, `permissions`, `user_roles` com scope, RLS nível company/unit, `consents`, `franchise_agreements`, `audit_log` particionado, testes E2E de isolamento entre scopes.

### `docs/decisions/000X-*.md` (8 ADRs)
Formato curto Michael Nygard (Context / Decision / Consequences / Status / Date). Cada um cristaliza uma decisão arquitetural já tomada na conversa para "Claude de amanhã" não re-perguntar.

### `CHANGELOG.md`
Formato Keep a Changelog. Início com bloco `[Unreleased]` e entrada `[0.0.0] - 2026-04-22 — Documentação inicial`.

### `.github/pull_request_template.md`
Checklist solo: Sprint # / Fecha issue / Testes verdes / RLS verificada (se aplicável) / CHANGELOG atualizado / ADR criado se houver decisão / Migration Drizzle revisada / Feature flag se feature nova.

### `docs/arquitetura.md` (atualização)
Atualizar seção "Tabelas mestras do MVP" e "Multi-tenancy" para refletir `groups`, `companies` (com flags), `units`. Adicionar seção nova "Comunicação entre camadas" explicando Server Components vs Server Actions vs Supabase SDK direto vs API Routes (pendência identificada na conversa).

---

## Ordem de execução

1. Copiar este plano para `docs/plano-estrutura.md` (fica versionado no repo como fonte histórica das decisões de estruturação)
2. Criar `docs/decisions/` (9 ADRs primeiro — são os "porquês" que os outros docs referenciam)
3. Criar `docs/rules.md`, `docs/multiempresa.md`, `docs/acesso-e-autorizacao.md`
4. Atualizar `docs/arquitetura.md`
5. Criar `docs/roadmap.md` e `docs/sprints/*`
6. Criar `CHANGELOG.md`, `.github/pull_request_template.md`
7. Criar `CLAUDE.md` (por último — referencia tudo acima)
8. Não commitar — usuário revisa e commita quando quiser

---

## Critical Files

- `D:\Projeto\LogiFit\CLAUDE.md` (novo, ~80 linhas)
- `D:\Projeto\LogiFit\docs\rules.md` (novo, ~150 linhas)
- `D:\Projeto\LogiFit\docs\acesso-e-autorizacao.md` (novo, ~200 linhas)
- `D:\Projeto\LogiFit\docs\multiempresa.md` (novo, ~180 linhas)
- `D:\Projeto\LogiFit\docs\decisions\0001-0008-*.md` (novos, ~50 linhas cada)
- `D:\Projeto\LogiFit\docs\sprints\00, 01a, 01b-*.md` + `_template.md` (novos)
- `D:\Projeto\LogiFit\docs\roadmap.md` (novo)
- `D:\Projeto\LogiFit\CHANGELOG.md` (novo)
- `D:\Projeto\LogiFit\.github\pull_request_template.md` (novo)
- `D:\Projeto\LogiFit\docs\arquitetura.md` (editar — adicionar groups/companies/units e seção de comunicação)
- `D:\Projeto\LogiFit\docs\plano-estrutura.md` (novo — cópia deste plano)

Total: 20 arquivos novos + 1 edição (9 ADRs + 4 sprints + 4 docs raiz-docs + `plano-estrutura.md` + `CHANGELOG.md` + `CLAUDE.md` + `.github/pull_request_template.md`).

---

## Verification

1. `ls docs/` mostra `rules.md`, `acesso-e-autorizacao.md`, `multiempresa.md`, `roadmap.md`, `arquitetura.md`, e subpastas `sprints/` + `decisions/` populadas
2. `ls docs/decisions/` mostra 8 ADRs numerados sequencialmente
3. `ls docs/sprints/` mostra `_template.md`, `00-setup-infra.md`, `01a-identidade-e-topology.md`, `01b-rbac-e-consent.md`
4. `ls .github/` mostra `pull_request_template.md`
5. `cat CLAUDE.md` contém referência explícita a `docs/rules.md` e `docs/sprints/`
6. `docs/arquitetura.md` contém palavras-chave `group`, `company`, `unit`, `topology`, `franchise_agreements`, `financial_mode`, `cross_company_access`, e tem seção "Comunicação entre camadas"
7. `docs/rules.md` contém 26 regras numeradas
8. `docs/multiempresa.md` contém os 4 cenários canônicos (rede própria, franquia clássica, franquia com passaporte, mix loja avulsa + rede no mesmo group) e a decisão de billing por tenant
9. `git status` mostra os arquivos novos como untracked; working tree limpo fora de `docs/`, `CHANGELOG.md`, `CLAUDE.md`, `.github/`
10. `git diff docs/arquitetura.md` mostra apenas a atualização de hierarquia + nova seção (sem reescrita destrutiva do conteúdo original)

---

## Fora de escopo deste plano (tratados depois)

- Criação do monorepo real (Turborepo, pnpm, Next.js, packages) — é o **Sprint 00**, executado depois da documentação estar aprovada
- Configuração de `.claude/settings.json` (hooks, permissions) — próxima conversa, depois que CLAUDE.md estiver firme
- Criação de subagents custom (ex: `drizzle-schema-reviewer`, `rls-auditor`) — avaliar necessidade após os primeiros 2–3 sprints
- Setup de Vercel/Supabase cloud — próxima fase
- Escolha final do hardware da catraca, estratégia mobile (PWA vs Expo) — decisões pendentes, levantadas na conversa, viram ADRs quando resolvidas
