# Sprint 00 — Setup de Infra

- **Início:** planejado
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #1

## Goal

Monorepo funcional, Supabase local rodando, CI verde, observabilidade ligada, **i18n configurado em 3 idiomas (pt-BR/en-US/es-419)** e **teste CI de RLS ativo**. Zero feature de negócio.

## Critério de aceite

- `pnpm dev` abre Next.js em `localhost:3000`
- `pnpm test` roda Vitest verde
- `pnpm db:migrate` aplica migrations Drizzle no Supabase local
- `pnpm db:rls-check` falha se encontrar tabela sem RLS habilitada (regra 2 enforced)
- `pnpm i18n:check` falha se encontrar chave faltando em qualquer locale (regra 27 enforced)
- CI (GitHub Actions) passa: type-check, Biome, Vitest, drizzle migrate dry-run, `db:rls-check`, `i18n:check`
- Sentry captura erro sintético em dev
- PostHog registra pageview
- Tokens "Equilíbrio Vital" aplicados em componente de teste (light/dark sem sombras residuais)
- **Idiomas: pt-BR default; en-US e es-419 funcionais;** troca via cookie `NEXT_LOCALE` + inferência por `Accept-Language`

## Dependências

- Nenhuma (é o primeiro sprint)

## Decisões tomadas

- [ADR 0001 — Stack base](../decisions/0001-stack-base.md)
- [ADR 0004 — Drizzle como fonte única do schema](../decisions/0004-drizzle-fonte-unica-schema.md)
- [ADR 0052 — i18n 3 idiomas](../decisions/0052-i18n-tres-idiomas-pt-en-es.md)
- [ADR 0071 — Sistema de tratamento de erros + alertas em tempo real](../decisions/0071-sistema-tratamento-erros-alertas-tempo-real.md) — **entrega infra base aqui** (envelope + wrappers + middleware + translators stubs + sanitização LGPD + regra 33 + lint)

## Commit

**Monorepo e infra core:**

- [ ] Turborepo + pnpm workspace inicializado
- [ ] `apps/web` com Next.js 15 + React 19 + Tailwind v4
- [ ] `packages/db` (Drizzle + supabase-js wrapper)
- [ ] `packages/ui` (shadcn custom + tokens "Equilíbrio Vital")
- [ ] `packages/ai` (Vercel AI SDK wrappers — esqueleto)
- [ ] `packages/types` (schemas Zod compartilhados — esqueleto)
- [ ] `packages/i18n` (configuração next-intl + loader de messages + utils)
- [ ] `packages/config` (tsconfig base + biome.json)
- [ ] Supabase CLI + docker-compose local
- [ ] Drizzle config + migration runner
- [ ] **Extensões PostgreSQL habilitadas no Supabase** (ADR 0062): `pg_trgm` (trigram para fuzzy search), `unaccent` (busca sem acento — "Jose" acha "José"); migration inicial `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;`
- [ ] **Scaffolding `<CommandPalette>` em `packages/ui`** (ADR 0062) — esqueleto do componente com overlay + input + slots de resultado (implementação completa no Sprint 07); hook `useCommandPalette()` + contexto global; atalhos `Ctrl+K` e `Cmd+K` registrados no provider root
- [ ] **Biblioteca de componentes base responsivos** (ADR 0063) em `packages/ui/`:
  - `layout/app-layout.tsx` — Esqueleto: header compacto com `<HamburgerTrigger>` (☰) + slot para conteúdo (página ocupa 100% da largura); **sem sidebar fixa** — navegação vai no overlay `<SideMenu>` do Sprint 00b
  - `layout/portal-layout.tsx` — Layout `/meu/*` otimizado PWA (safe-area-inset, viewport meta, install prompt); também usa padrão overlay para navegação
  - `layout/responsive-modal.tsx` — Full-screen em mobile ↔ centered em desktop
  - `layout/responsive-table.tsx` — `<table>` em `md+` ↔ `<CardList>` em mobile; colunas marcam `priority: 'always'|'md'|'lg'`
  - `layout/responsive-form.tsx` — Grid 2-col em `lg+` ↔ stack 1-col em mobile; `<StickyFooter>` com botões primários fixos no rodapé mobile
  - `nav/breadcrumbs.tsx` — Colapsa em mobile com "..." truncado
  - **Implementação completa do `<SideMenu>` (hamburger overlay + registry por módulo + filtros) fica no Sprint 00b** — aqui entra apenas o slot do `<HamburgerTrigger>` no `<AppLayout>`
- [ ] **Tokens responsivos** em `packages/ui/tokens.ts`: `min-h-touch` = 44px, `min-h-input` = 48px, utility `safe-area-*` (top/bottom/left/right para iPhone notch + home indicator), breakpoints sincronizados com Tailwind
- [ ] **Helper `packages/config/playwright-viewports.ts`** — exporta matrix: `iphone-13` (390×844), `pixel-5` (393×851), `ipad-portrait` (768×1024), `ipad-landscape` (1024×768), `desktop-1280`, `desktop-1920`; função `forEachViewport(test, name, fn)` que roda teste em 3 canônicos por padrão
- [ ] **Meta viewport correta** em `app/layout.tsx` — `viewport: { width: 'device-width', initialScale: 1, maximumScale: 1, viewportFit: 'cover' }` (Next.js 15 metadata API)
- [ ] **Regra Biome/ESLint custom "no-desktop-only-layout"** — falha CI se `className` em `<button>` clicável tem `h-<valor <44>` sem classe `min-h-touch` override; falha se `<table>` é usada diretamente fora de `<ResponsiveTable>`
- [ ] **Teste visual Playwright base** em `apps/web/e2e/responsiveness.spec.ts` — roda homepage + /login + /signup em 3 viewports; screenshot baseline + assertiva de não overflow horizontal em mobile

**Sistema de tratamento de erros (ADR 0071 + regra 33):**

- [ ] `packages/errors/` base:
  - `api-error.ts` (envelope + 16 códigos fechados: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `AI_QUOTA_EXCEEDED`, `AI_PROVIDER_ERROR`, `PAYMENT_FAILED`, `FISCAL_REJECTED`, `CONSENT_REQUIRED`, `COMMITTEE_REQUIRED`, `SLUG_TAKEN`, `TENANT_SUSPENDED`)
  - `wrap-action.ts` — wrapper Server Actions (auth + permissions + rate limit + gate IA/consent + translator + alert async + audit + Sentry + retorno tipado `{ ok, data | error }`)
  - `wrap-api-handler.ts` — wrapper API Routes equivalente
  - `wrap-job.ts` — wrapper jobs assíncronos (Vercel Cron)
  - `translators/` com 10 stubs iniciais (asaas, focus-nfe, supabase, anthropic, gemini, groq, openai, twilio, tiss, pluggy, zod) + fallback genérico; sprints de integração populam real
  - `sanitize.ts` (sanitização LGPD: CPF/CNPJ mask, email mask, senha/token/dado clínico redacted)
  - `fingerprint.ts` (SHA256 com `tenant_id` para dedup multi-tenant)
- [ ] Middleware `apps/web/middleware.ts` injeta `x-request-id` (UUID) em toda request
- [ ] Sentry client configurado com tags (`tenant_id`, `request_id`, `module`, `action`) — captura `INTERNAL_ERROR` para dev team LogiFit
- [ ] PostHog client com `$user_id` + `$tenant_id` + captura UX events
- [ ] Logtail client com structured logging (JSON)
- [ ] **Biome lint rule custom `no-unwrapped-action`** — bloqueia Server Action/API Route sem `wrapAction`/`wrapApiHandler` (exceção via comentário `// wrap-exempt: <motivo>`)
- [ ] i18n catalog: mensagens dos 16 códigos + mensagens dos translators nos 3 locales (regra 27)
- [ ] Teste E2E: Server Action com panic → retorna envelope `{ok:false, error:{code:'INTERNAL_ERROR', request_id}}` + `system_alerts` criado (mock) + Sentry capturou + toast aparece no frontend

**i18n (ADR 0052):**

- [ ] Instalar `next-intl` v4+ no `apps/web`
- [ ] Middleware de detecção de locale (`middleware.ts`) com cookie `NEXT_LOCALE` + fallback `Accept-Language` + default `pt-BR`
- [ ] Estrutura `apps/web/src/messages/{pt-BR,en-US,es-419}/` com namespace mínimo (`common.json` + `auth.json`)
- [ ] Seed de strings comum em 3 locales (tradução inicial via Claude para en/es; revisar antes de release)
- [ ] `packages/i18n/config.ts` exporta `LOCALES = ['pt-BR', 'en-US', 'es-419']` + `DEFAULT_LOCALE = 'pt-BR'`
- [ ] Script `pnpm i18n:extract` que percorre código e lista chaves usadas via regex `/t\(['"]([^'"]+)['"]\)/`
- [ ] Script `pnpm i18n:check` que compara chaves usadas vs presentes em cada locale; falha CI se divergir
- [ ] Componente `<LocaleSwitcher>` em `packages/ui`
- [ ] Formatação de datas/números via `Intl` nativo wrapado em helpers de `packages/i18n`

**RLS e qualidade:**

- [ ] Script `packages/db/tests/rls-check.ts` — lê schema Drizzle, verifica cada tabela tem `tenant_id` + policy RLS; falha se faltar (enforcement da regra 1+2)
- [ ] CI GitHub Actions (`.github/workflows/ci.yml`) roda: `typecheck`, `biome:check`, `vitest`, `drizzle:migrate:dry`, `db:rls-check`, `i18n:check`
- [ ] `biome.json` com regra custom de "no-hardcoded-strings" (ou fallback: comentário convencional) para evitar violação da regra 27
- [ ] Sentry + PostHog integrados em `app/layout.tsx`
- [ ] Logtail/Axiom para logs estruturados (era stretch, agora core)
- [ ] Pre-commit hook com biome + i18n:check

**Observabilidade de IA (novo):**

- [ ] `packages/ai/observability.ts` — wrapper de logging padrão para chamadas IA (tokens, latência, modelo, cache hit/miss, custo)
- [ ] Dashboard PostHog com eventos `ai.call`, `ai.cache_hit`, `ai.error`

**README e docs:**

- [ ] README atualizado com `pnpm dev`, `pnpm test`, `pnpm db:migrate`, `pnpm db:rls-check`, `pnpm i18n:check`

## Stretch

- [ ] Storybook para `packages/ui` com preview em 3 locales
- [ ] Integração Translation Memory (TM) para reuso de tradução cross-sprint

## Log

- —

## Definition of Done

- [ ] `pnpm dev` funciona em pt-BR (default)
- [ ] Troca de locale via cookie funciona (pt-BR → en-US → es-419 → pt-BR)
- [ ] `pnpm test` verde
- [ ] `pnpm db:rls-check` funcional (cria tabela sem RLS em branch de teste → script falha)
- [ ] `pnpm i18n:check` funcional (remove chave de en-US em branch de teste → script falha)
- [ ] CI verde no branch
- [ ] Sentry + PostHog capturando em dev
- [ ] Tokens "Equilíbrio Vital" aplicados sem sombras residuais do shadcn
- [ ] LocaleSwitcher funcional
- [ ] CHANGELOG.md entrada `[Unreleased] - Added — Monorepo, CI, observabilidade, i18n 3 idiomas`
- [ ] Roadmap atualizado (item #1 → done)

## Retro

- —
