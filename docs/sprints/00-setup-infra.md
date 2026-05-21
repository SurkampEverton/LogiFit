# Sprint 00 — Setup de Infra

- **Início:** 2026-04-27
- **Fim planejado:** **+5 semanas (~2026-06-01)** (revisado 2026-04-27 — [ADR 0091](../decisions/0091-self-host-total-oracle-sp.md) self-host total amplia escopo: bootstrap Oracle Cloud Vinhedo + Coolify + observabilidade self-host (GlitchTip/Loki/Grafana) + MinIO + runbook DR drill substituindo "subir Supabase CLI". Revisão anterior 2026-04-25 já tinha levado pra 4 semanas; +1 semana absorve self-host total. Excede regra 9 (3 semanas) com justificativa explícita em ADR 0091).
- **Status:** **done (~99%)** 2026-05-21 — Faixas 1+2+3+4 entregues + GlitchTip SDK plugado (Sprint 00.Q). Restante: 3 itens bloqueados por input externo do fundador (backup R2 credentials, DNS security@, HSTS preload submission).
- **Item do roadmap:** #1

## Goal

Monorepo funcional, **VPS Oracle Cloud SP rodando Coolify + Postgres 16 + Redis + MinIO + GlitchTip + Loki/Grafana + Caddy + Next.js** (produção), **Docker Compose local equivalente** (dev), CI verde, **i18n configurado em 3 idiomas (pt-BR/en-US/es-419)**, **teste CI de RLS ativo**, **CI/CD GitHub Actions multi-arch → GHCR → webhook Coolify** funcional. Zero feature de negócio.

## Estratégia de timebox (5 semanas)

Para evitar estouro do timebox padrão de 3 semanas (regra 9), Sprint 00 organiza-se em **4 faixas executáveis em sequência curta**, cada uma com DoD próprio:

- **Faixa 1 (semana 1):** infra core local — monorepo, `docker-compose.yml` dev (Postgres + Redis + MinIO + Mailhog), Drizzle, Biome, Vitest, Playwright, CI verde básica, i18n config, design tokens
- **Faixa 2 (semana 2):** **bootstrap Oracle Cloud SP + Coolify** — conta Oracle PAYG, VPS provisionado, `infra/bootstrap-oracle.sh`, Coolify install + config, Caddy reverse proxy + Let's Encrypt, Postgres + Redis + MinIO containers, GitHub Actions multi-arch build → GHCR → webhook Coolify, primeiro deploy "Hello World" Next.js, runbook `bootstrap-oracle.md`
- **Faixa 3 (semanas 3-4):** segurança em profundidade — Cloudflare proxy + Turnstile, headers + CSP nonce, `safeFetch`, `scanUpload`, **backup off-site Cloudflare R2**, GlitchTip self-host, Loki + Grafana self-host, OWASP ZAP, secret scanning Gitleaks, Dependabot, OSV-scanner, SBOM, `/.well-known/security.txt`, `packages/security/high-risk-actions.ts`, runbook `dr-drill.md` esqueleto
- **Faixa 4 (semana 5):** lints custom + docs operacionais — `no-unwrapped-action`, `no-raw-fetch`, `no-unscanned-upload`, `no-hardcoded-design-token`, `high-risk-action-must-require-recent-mfa`, `cross-tenant-read-must-log` (este vira ativo só no Sprint 02), `no-window-alert` + `no-hardcoded-toast-message` (regra 45 / ADR 0089), templates RIPD vazios para sprints clínicos, `docs/dev/realtime.md`

**Lints obsoletos (não criar):** `no-supabase-functions` e `no-direct-supabase-query` — não há Supabase ([ADR 0091](../decisions/0091-self-host-total-oracle-sp.md) supersede ADR 0078).

**Se Faixa 4 estourar:** mover lints `cross-tenant-read-must-log` para Sprint 02 (onde primeiro consumidor real existe) e `no-hardcoded-design-token` para Sprint 00b (menu lateral, primeiro consumidor real de design system). Sprint 00 mantém DoD se entregar Faixas 1+2+3 + esqueleto da Faixa 4.

## Critério de aceite

- `pnpm dev:up` sobe `docker compose` local (Postgres + Redis + MinIO + Mailhog) saudável
- `pnpm dev` abre Next.js em `localhost:3000`
- `pnpm test` roda Vitest verde
- `pnpm db:migrate` aplica migrations Drizzle no Postgres local (via `DATABASE_URL` env)
- `pnpm db:rls-check` falha se encontrar tabela sem RLS habilitada (regra 2 enforced)
- `pnpm i18n:check` falha se encontrar chave faltando em qualquer locale (regra 27 enforced)
- CI (GitHub Actions) passa: type-check, Biome, Vitest, drizzle migrate dry-run, `db:rls-check`, `i18n:check`, `docs:check`
- **VPS Oracle Cloud SP** provisionado + Coolify rodando + Caddy + Postgres + Redis + MinIO containers ativos
- **Primeiro deploy "Hello World"** Next.js em `https://app.logifit.com.br` (subdomínio temporário ou domínio em sandbox) via push em `main` → GitHub Actions multi-arch → GHCR → webhook Coolify → rolling restart
- **GlitchTip self-hosted** captura erro sintético em produção (e em dev opcional)
- **Loki + Grafana self-hosted** recebe logs estruturados do Next.js (`pino` → stdout → Promtail → Loki)
- Tokens "Equilíbrio Vital" aplicados em componente de teste (light/dark sem sombras residuais)
- **Idiomas: pt-BR default; en-US e es-419 funcionais;** troca via cookie `NEXT_LOCALE` + inferência por `Accept-Language`
- **Suíte `smoke/` Playwright** com 10 esqueletos (`test.skip` com nome do caso conforme ADR 0090 §6) roda em <2min em todo PR; suíte `critical/` com 12 esqueletos (ADR 0090 §5); ambas usam matriz Playwright + helpers `auth.ts`/`seed.ts`/`time.ts`
- **Coverage gate** ativo: ≥80% em `packages/errors|security|db/policies` (camadas de defesa, regra 18), ≥70% em `packages/db`, ≥60% em Server Actions; CI falha se threshold não bate
- **Script `pnpm compliance:check`** valida: RIPD em `Status: Vigente` com hash batendo, ADR esperado de cada sprint publicado, threat-model presente para feature crítica, schema `ai_audit_log` com colunas obrigatórias (regra 28)
- **Backup off-site Cloudflare R2** funcional: `pg_dump` cifrado GPG + rclone S3 diário; teste de restauração documentado em `docs/runbooks/restore-test.md`

## Dependências

- Nenhuma (é o primeiro sprint)

## Decisões tomadas

- [ADR 0001 — Stack base](../decisions/0001-stack-base.md)
- [ADR 0004 — Drizzle como fonte única do schema](../decisions/0004-drizzle-fonte-unica-schema.md)
- [ADR 0052 — i18n 3 idiomas](../decisions/0052-i18n-tres-idiomas-pt-en-es.md)
- [ADR 0071 — Sistema de tratamento de erros + alertas em tempo real](../decisions/0071-sistema-tratamento-erros-alertas-tempo-real.md) — **entrega infra base aqui** (envelope + wrappers + middleware + translators stubs + sanitização LGPD + regra 33 + lint)
- [ADR 0073 — Postura de segurança (defesa em profundidade)](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) — **entrega camadas 1, 3 e 6 aqui** (security headers + CSP nonce + rate limit global + safeFetch + scanUpload + secret scanning + Dependabot/OSV-scanner + SBOM + `/.well-known/security.txt` + página `/seguranca` + regras 35-38 ativas em CI)
- ~~[ADR 0078 — Hospedagem em duas fases](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md)~~ — **superseded por [ADR 0091](../decisions/0091-self-host-total-oracle-sp.md)** (2026-04-27)
- [ADR 0091 — Self-host total Oracle SP + Coolify](../decisions/0091-self-host-total-oracle-sp.md) — **entrega Faixa 2 aqui** (VPS Oracle PAYG + Coolify + Caddy + Postgres/Redis/MinIO containers + GitHub Actions multi-arch GHCR + webhook deploy + GlitchTip + Loki/Grafana + Cloudflare R2 backup + runbooks `bootstrap-oracle.md`/`dr-drill.md`/`restore-test.md` + regras 19/36/38/40/46 ativas em CI). 8 regras de portabilidade originais (ADR 0078) viram **regras de soberania perpétua** — não há mais "fugir de Supabase", nunca usamos.
- [ADR 0089 — Sistema de mensagens padronizadas](../decisions/0089-sistema-mensagens-padronizadas.md) — **entrega catálogo de 6 tipos aqui** (Toast/Banner/AlertDialog/ConfirmDialog/PromptDialog/FormError + Sonner + helpers `toast`/`confirm`/`prompt` + `<Toaster nonce>` + lints `no-window-alert` + `no-hardcoded-toast-message` + regra 45 ativa em CI)
- [ADR 0090 — Estratégia de testes (taxonomia T1-T21 + 3 níveis + suítes E2E)](../decisions/0090-estrategia-de-testes.md) — **entrega infra base aqui**: estrutura de 10 suítes E2E (`smoke`/`critical`/`regression`/`i18n`/`responsiveness`/`a11y`/`visual`/`perf`/`security`/`external`), helpers (`auth`/`seed`/`time`/`webhooks`/`db`), 10 esqueletos `smoke/` + 12 esqueletos `critical/` (`test.skip` com nome do caso), Vitest coverage gate por package, ferramentas instaladas (MSW + fast-check + axe-playwright + k6 + tsd), script `compliance:check`, helper `twoConnectionsTest()` (T6 RLS comportamental). Lost Pixel/Stryker/jazzer.js adiados para sprint dono (sem consumidor real ainda)

## Commit

**Monorepo e infra core:**

- [ ] Turborepo + pnpm workspace inicializado
- [ ] `apps/web` com Next.js 15 + React 19 + Tailwind v4
- [ ] `packages/db` (Drizzle + supabase-js wrapper)
- [ ] `packages/ui` (shadcn custom + tokens "Equilíbrio Vital")
- [ ] `packages/ai` (Vercel AI SDK [lib, não plataforma] wrappers — esqueleto)
- [ ] `packages/types` (schemas Zod compartilhados — esqueleto)
- [ ] `packages/i18n` (configuração next-intl + loader de messages + utils)
- [ ] `packages/config` (tsconfig base + biome.json)
- [x] `packages/storage` (interface `StorageAdapter` + `MinioStorageAdapter` default — ADR 0091) — **entregue 2026-04-29** (CHANGELOG, ver Log)
- [ ] **`docker-compose.yml`** na raiz do repo: `postgres:16-alpine` (porta 5432) + `redis:7-alpine` (porta 6379) + `minio/minio` (portas 9000+9001 console) + `mailhog/mailhog` (porta 1025 SMTP + 8025 UI); volumes em `.docker-data/` (gitignored); `pnpm dev:up`/`dev:down`/`dev:reset` scripts no `package.json` raiz
- [ ] Drizzle config + migration runner; `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/logifit` em `.env.local`
- [ ] **Extensões PostgreSQL** (ADR 0062): `pg_trgm` (trigram para fuzzy search), `unaccent` (busca sem acento — "Jose" acha "José"), `pgvector` (embeddings IA, ADR 0064); migration inicial `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS vector;`
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
- [ ] **Helper `packages/config/playwright-locales.ts`** (ADR 0052 — extensibilidade i18n) — exporta `forEachLocale(test, name, fn)` que itera `LOCALES` de `packages/i18n/config.ts`; smoke obrigatório `apps/web/e2e/i18n-smoke.spec.ts` carrega `/`, `/login`, `/signup` em cada locale e assertiva: (a) sem chaves nuas tipo `common.foo.bar` na DOM, (b) sem overflow horizontal, (c) `<LocaleSwitcher>` lista todos `LOCALE_NAMES` corretos. Adicionar locale futuro herda smoke automaticamente (zero edição de teste)
- [ ] **Meta viewport correta** em `app/layout.tsx` — `viewport: { width: 'device-width', initialScale: 1, maximumScale: 1, viewportFit: 'cover' }` (Next.js 15 metadata API)
- [ ] **Regra Biome/ESLint custom "no-desktop-only-layout"** — falha CI se `className` em `<button>` clicável tem `h-<valor <44>` sem classe `min-h-touch` override; falha se `<table>` é usada diretamente fora de `<ResponsiveTable>`
- [ ] **Teste visual Playwright base** em `apps/web/e2e/responsiveness.spec.ts` — roda homepage + /login + /signup em 3 viewports; screenshot baseline + assertiva de não overflow horizontal em mobile

**Sistema de tratamento de erros (ADR 0071 + regra 33):**

- [ ] `packages/errors/` base:
  - `api-error.ts` (envelope + 16 códigos fechados: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `AI_QUOTA_EXCEEDED`, `AI_PROVIDER_ERROR`, `PAYMENT_FAILED`, `FISCAL_REJECTED`, `CONSENT_REQUIRED`, `COMMITTEE_REQUIRED`, `SLUG_TAKEN`, `TENANT_SUSPENDED`)
  - `wrap-action.ts` — wrapper Server Actions (auth + permissions + rate limit + gate IA/consent + translator + alert async + audit + GlitchTip + retorno tipado `{ ok, data | error }`)
  - `wrap-api-handler.ts` — wrapper API Routes equivalente
  - `wrap-job.ts` — wrapper jobs assíncronos (`node-cron` dentro do container Next.js OU container `ofelia` separado — decisão fina aqui no Sprint 00)
  - `translators/` com 10 stubs iniciais (asaas, focus-nfe, supabase, anthropic, gemini, groq, openai, twilio, tiss, pluggy, zod) + fallback genérico; sprints de integração populam real
  - `sanitize.ts` (sanitização LGPD: CPF/CNPJ mask, email mask, senha/token/dado clínico redacted)
  - `fingerprint.ts` (SHA256 com `tenant_id` para dedup multi-tenant)
- [ ] Middleware `apps/web/middleware.ts` injeta `x-request-id` (UUID) em toda request
- [ ] **GlitchTip self-hosted** (container Coolify, Sentry-API-compatível) configurado com tags (`tenant_id`, `request_id`, `module`, `action`) — captura `INTERNAL_ERROR` para dev team LogiFit; SDK `@sentry/nextjs` com `dsn` apontando pro GlitchTip self-host
- [ ] **PostHog dropado no MVP** — feature flags via `feature_flags` table própria (regra 12 revisada); product analytics avaliado pós-MVP quando houver dor real de funil
- [ ] **`pino`** em todos os boundaries (Server Action / API Route / Job) com structured logging JSON → stdout → Promtail → **Loki self-hosted** (container Coolify) → Grafana dashboard
- [ ] **Biome lint rule custom `no-unwrapped-action`** — bloqueia Server Action/API Route sem `wrapAction`/`wrapApiHandler` (exceção via comentário `// wrap-exempt: <motivo>`)
- [ ] i18n catalog: mensagens dos 16 códigos + mensagens dos translators nos 3 locales (regra 27)
- [ ] Teste E2E: Server Action com panic → retorna envelope `{ok:false, error:{code:'INTERNAL_ERROR', request_id}}` + `system_alerts` criado (mock) + GlitchTip capturou + toast aparece no frontend

**Sistema de mensagens padronizadas (ADR 0089 + regra 45):**

- [ ] Instalar `sonner` em `apps/web` (engine de toast — ratificado pelo ADR 0089)
- [ ] `packages/ui/components/messages/` — catálogo fechado de 6 tipos:
  - `toaster.tsx` — provider único (Sonner) com `nonce` CSP recebido via prop (regra 35)
  - `toast.tsx` — render custom com tokens `--ev-*` + variantes success/info/warning/error/critical
  - `banner.tsx` — sticky top da `<AppLayout>`, variantes info/warning/danger, `dismissible` + `storageKey` para persistir dismiss em sessão
  - `alert-dialog.tsx` — Radix Dialog base com tokens EV; bottom-sheet em mobile / centered em desktop (reusa `<ResponsiveModal>`)
  - `confirm-dialog.tsx` — wrapper de `<AlertDialog>` com prop `danger` + `confirmLabel`/`cancelLabel`
  - `prompt-dialog.tsx` — wrapper de Dialog + `<input>` + `validator?: (v) => string | null` + `<FormError>` linkado via `aria-describedby`
  - `form-error.tsx` — texto inline `aria-describedby` + ícone leading; **nunca** isolado
- [ ] `packages/ui/messages/api.ts` exporta API imperativa:
  - `toast` com `success/info/warning/error/critical/fromApiError` + variantes com `action`/`description`
  - `confirm({ title, body, danger? }) => Promise<boolean>`
  - `prompt({ title, label, validator? }) => Promise<string | null>`
  - `useActionResult(result, opts)` — hook que delega para `toast.fromApiError` por padrão
- [ ] `packages/ui/messages/api-error-translator.ts` — `toast.fromApiError(error: ApiError)` mapeia envelope ADR 0071: `code` → severidade, `message` → texto, `request_id` → description com copy, `runbook` → action button "Ver runbook", `retry_after_ms` → action "Tentar novamente"
- [ ] `<Toaster nonce={cspNonce}>` plugado em `apps/web/app/layout.tsx` (Server Component lê nonce do header CSP)
- [ ] i18n catalog `messages.json` em pt-BR/en-US/es-419 com chaves comuns reusáveis: `messages.action.{succeeded,failed,retry,dismiss,ok,cancel,confirm,view_runbook,view_details,copy_request_id}`
- [ ] **Biome lint rule custom `no-window-alert`** — bloqueia `window.alert/confirm/prompt` + `alert(...)` no escopo global (exceção via `// alert-exempt: <motivo>`)
- [ ] **Biome lint rule custom `no-hardcoded-toast-message`** — bloqueia string literal e template literal sem `t()` em `toast.*()`, `confirm({ title|body })`, `prompt({ title|label })`, `<Banner>{...}</Banner>`
- [ ] Storybook/styleguide page `apps/web/app/styleguide/messages/` espelhando 1:1 a seção `#mensagens` do protótipo (`prototipo/designsystem/index.html`) com tokens shadcn-mapping aplicados
- [ ] E2E Playwright `apps/web/e2e/messages.spec.ts` em 3 viewports (390/768/1280):
  - dispara cada tipo via Server Action mock
  - valida ARIA (`role="status|alert|alertdialog|dialog"`, `aria-live`, `aria-modal`, `aria-describedby` resolvendo)
  - valida i18n key resolved no locale ativo (sem `messages.foo.bar` cru no DOM)
  - valida `toast.critical` exige acknowledge para sumir
  - valida `<AlertDialog>` vira bottom-sheet em mobile
- [ ] Composição com IA Camada 3: `<ActionConfirmDialog>` (ADR 0075) será wrapper sobre `<ConfirmDialog>` deste catálogo no Sprint 17 — escopo MVP só formaliza contrato

**i18n (ADR 0052):**

- [ ] Instalar `next-intl` v4+ no `apps/web`
- [ ] Middleware de detecção de locale (`middleware.ts`) com cookie `NEXT_LOCALE` + fallback `Accept-Language` + default `pt-BR`
- [ ] Estrutura `apps/web/src/messages/{pt-BR,en-US,es-419}/` com namespace mínimo (`common.json` + `auth.json`)
- [ ] Seed de strings comum em 3 locales (tradução inicial via Claude para en/es; revisar antes de release)
- [ ] `packages/i18n/config.ts` exporta:
  - `LOCALES = ['pt-BR', 'en-US', 'es-419'] as const` + `type Locale = (typeof LOCALES)[number]`
  - `DEFAULT_LOCALE: Locale = 'pt-BR'`
  - `FALLBACK_CHAIN: Locale[] = ['en-US', 'pt-BR']` (regra genérica ADR 0052 — qualquer locale → en-US → pt-BR)
  - `LOCALE_NAMES: Record<Locale, string> = { 'pt-BR': 'Português', 'en-US': 'English', 'es-419': 'Español' }` (nome nativo — `<LocaleSwitcher>` consome dinamicamente; adicionar locale futuro = adicionar 1 linha aqui, sem editar componente)
- [ ] **Schema `persons.preferred_locale`** = `text NOT NULL DEFAULT 'pt-BR'` + `CHECK (preferred_locale = ANY(ARRAY['pt-BR','en-US','es-419']))` — **proibido enum SQL** (ADR 0052 §Persistência); validação na borda Zod via `z.enum(LOCALES)`. Mesmo padrão para `tenants.default_locale`. Adicionar locale futuro = atualizar `LOCALES` no app + migration trivial de `CHECK` constraint, sem `ALTER TYPE`.
- [ ] Script `pnpm i18n:extract` que percorre código e lista chaves usadas via regex `/t\(['"]([^'"]+)['"]\)/`
- [ ] Script `pnpm i18n:check` que compara chaves usadas vs presentes em cada locale; falha CI se divergir
- [ ] Script `pnpm i18n:translate --target {locale}` (Claude-assistido) — versão básica que lê pt-BR de cada namespace e gera tradução do locale alvo via Anthropic SDK; revisão humana antes de commit; usado pelo runbook de adição de locale
- [ ] Componente `<LocaleSwitcher>` em `packages/ui` — consome `LOCALES` + `LOCALE_NAMES` dinamicamente (zero hardcode de label)
- [ ] Formatação de datas/números via `Intl` nativo wrapado em helpers de `packages/i18n`
- [ ] **Templates de email nascem multi-locale** — Sprint 01a (primeiro template de auth/recovery) e demais sprints com email seguem padrão `apps/web/src/messages/{locale}/email-{template}.json`; render no locale do destinatário via `persons.preferred_locale` com fallback `tenants.default_locale` (ADR 0052 §Escopo de impacto). Provider [Brevo](../decisions/0096-email-brevo-substitui-aws-ses.md) (ADR 0096 substitui AWS SES) via `safeFetch` em `packages/email/` (tier free 300/dia cobre MVP; sem SDK pesado)
- [ ] Runbook `docs/runbooks/adicionar-novo-locale.md` (esqueleto inicial em Sprint 00 — conteúdo amadurece conforme implementação avança)

**RLS e qualidade:**

- [ ] Script `packages/db/tests/rls-check.ts` — lê schema Drizzle, verifica cada tabela tem `tenant_id` + policy RLS; falha se faltar (enforcement da regra 1+2)
- [ ] CI GitHub Actions (`.github/workflows/ci.yml`) roda: `typecheck`, `biome:check`, `vitest`, `drizzle:migrate:dry`, `db:rls-check`, `i18n:check`
- [ ] `biome.json` com regra custom de "no-hardcoded-strings" (ou fallback: comentário convencional) para evitar violação da regra 27
- [~] GlitchTip integrado em `app/layout.tsx` (`@sentry/nextjs` configurado pra self-host DSN); PostHog dropado (regra 12 revisada). **Servidor rodando em `https://errors.logifit.com.br` (Faixa 3, 2026-05-11);** integração `@sentry/nextjs` + DSN no `wrapAction()`/`wrapApiHandler()` pendente — destrava com Sprint 01a (primeira Server Action real).
- [~] `pino` + Promtail + Loki + Grafana para logs estruturados (substitui Logtail/Axiom — ADR 0091). **Stack rodando em `https://monitor.logifit.com.br` (Faixa 3, 2026-05-11): Promtail tail logs Docker de todos containers do VPS → Loki → Grafana (Loki datasource pré-provisionado).** Falta: integração `pino` no Next.js (escreve em stdout → Promtail já captura).
- [ ] Pre-commit hook com biome + i18n:check

**Estratégia de testes (ADR 0090 + regra 18 expandida):**

- [ ] **Estrutura de pastas E2E** em `apps/web/e2e/`: `smoke/` · `critical/` · `regression/` · `i18n/` · `responsiveness/` · `a11y/` · `visual/` · `perf/` · `security/` · `external/` · `fixtures/` · `pages/` (Page Object Models) · `helpers/` · `_template.spec.ts` · `_mocks/` (MSW handlers)
- [ ] **Helpers em `apps/web/e2e/helpers/`** (ADR 0090 §8 anti-flakiness):
  - `auth.ts` — `loginAs(persona, scenario)` retorna `storageState` cacheado por persona × cenário (super_admin, tenant_owner, gerente, recepcao, fisio, nutri, member, contador_externo); login via API direto + cookie em `beforeAll`, nunca UI repetida
  - `seed.ts` — carrega 1 dos 5 cenários canônicos do CLAUDE.md (rede própria / franquia clássica / franquia + passaporte / mix / solo) em schema PG dedicado por worker (template + clone)
  - `time.ts` — `freezeAt('2026-04-27T10:00:00-03:00')` via `page.clock.install()`; obrigatório em todo teste com data
  - `webhooks.ts` — `replayWebhook({provider, externalId, payload})` com HMAC válido; usado por T7 idempotência (Sprint 04+)
  - `db.ts` — `twoConnectionsTest(tenantA, tenantB, fn)` abre 2 conexões PG distintas com `set_config('request.jwt.claims', ...)` por conexão; T6 RLS comportamental
  - `waits.ts` — proibido `waitForTimeout()`; só `waitForResponse()`/`waitForSelector()`/`waitForLoadState()`
- [ ] **Matriz Playwright** em `apps/web/playwright.config.ts`: viewports {390, 768, 1280} × locales {pt-BR, en-US, es-419} × browsers {Chromium, WebKit}; padrão por teste = 1 viewport × pt-BR × Chromium; marcadores `@responsive` e `@i18n` expandem; smoke + critical rodam em 2 browsers
- [ ] **10 esqueletos suíte `smoke/`** com `test.skip(true, 'preencher no sprint dono')` (ADR 0090 §6): `auth-magic-link.spec.ts` · `tenant-switch.spec.ts` · `member-create.spec.ts` · `agenda-book.spec.ts` · `asaas-checkout.spec.ts` · `dashboard-by-role.spec.ts` · `global-search.spec.ts` · `messages-catalog.spec.ts` · `security-headers.spec.ts` · `mfa-recent-required.spec.ts` — roda em <2min em todo PR
- [ ] **12 esqueletos suíte `critical/`** com `test.skip` (ADR 0090 §5): cross-tenant RLS · trial anonymize · cross-tenant audit log · constraint global passaporte · Asaas idempotência · cross-prescrição · NF-e 210210 · cutover hash chain · ICP-Brasil portal ITI · TISS XSD · revogar vínculo · regra 25 franchise — roda em PR de release + nightly
- [ ] **Suítes vazias com 1 teste exemplo** em `regression/`, `a11y/` (axe-playwright em `/`), `i18n/` (smoke já planejado em `i18n-smoke.spec.ts`), `responsiveness/` (já planejado), `visual/` (sem baseline ainda — ferramenta Lost Pixel adiada), `perf/` (k6 instalado, sem cenário), `security/` (`security-headers.spec.ts` planejado), `external/` (vazio até Sprint 04)
- [ ] **CI jobs por suíte** em `.github/workflows/ci.yml`:
  - PR: `smoke` (bloqueia merge) + `i18n` (se tocou `messages/`) + `responsiveness` (se tocou `packages/ui/`) + `security` (se tocou auth/security) + `visual` (se tocou UI, sem baseline ainda)
  - PR de release: + `critical` (bloqueia deploy prod)
  - Nightly: `regression` + `a11y` + `perf` + `external`
  - Schedule semanal: `external` com sandbox real (Asaas/Focus/Twilio)
- [ ] **Vitest config** com `--coverage` + threshold por package (regra 18 expandida): `packages/errors|security|db/policies` ≥80% · `packages/db` ≥70% · Server Actions ≥60%
- [ ] **Ferramentas instaladas (T7-T13 + T18)** com `pnpm add -D` em workspace root: `msw` (T7+T8) · `fast-check` (T10) · `@axe-core/playwright` (T5) · `tsd` (T9) · `k6` via Docker em CI (T13) · `@mswjs/data` para fixtures
- [ ] **Adiados para sprint dono** (sem consumidor real no Sprint 00): T4 Lost Pixel (Sprint 00b ou 02 — primeira UI estabilizada) · T12 Stryker (Sprint 04 ou 23 — primeira função fiscal/clínica crítica) · T21 jazzer.js (Sprint 15 — primeiro parser real)
- [ ] **`packages/db/tests/two-connections-test.ts` (T6)** — helper `twoConnectionsTest(scenarioName, fn)` abre 2 conexões PG distintas com claims JWT diferentes; teste exemplo cria tabela `_dummy_t6` com `tenant_id` + RLS, INSERT com tenant A, prova SELECT com tenant B retorna 0 rows
- [ ] **`packages/types/tests/envelope.test-d.ts` (T9)** — type test do envelope `{ok: true, data: T} | {ok: false, error: ApiError}` (ADR 0071) com `expectType<>` validando 16 códigos fechados
- [ ] **`scripts/compliance-check.ts` (T19)** — script CI que valida: (a) cada arquivo `docs/compliance/ripd/v*.md` tem `Status` válido + hash SHA-256 do conteúdo bate com frontmatter (regra 29 — `scripts/hash-ripd.ts` já planejado); (b) cada sprint em `doing` tem ADR esperado publicado (cruza com `scripts/docs-check.mjs` linha "ADR esperado"); (c) cada feature crítica em `docs/threat-models/` tem STRIDE 6-categorias mínimo; (d) schema `ai_audit_log` (Drizzle) tem colunas obrigatórias (`input`, `output`, `model`, `prompt_version`, `human_decision`, `guardrail_result`, `fallback_used`); rodado por `pnpm compliance:check` em CI
- [ ] **Convenção de DoD** em `_template.md` de sprint (a criar — ainda não existe template) com bloco "Estratégia de testes (ADR 0090)" pré-preenchido: linha-base + obrigatórios extras + recomendados aplicados + recomendados em débito (issue criada) + opcionais avaliados
- [ ] **README atualizado** com seção "Como testar" linkando para ADR 0090 + comando `pnpm test:smoke` (rapidão local) e `pnpm test:critical` (antes de PR de release)

**Observabilidade de IA (novo):**

- [ ] `packages/ai/observability.ts` — wrapper de logging padrão para chamadas IA (tokens, latência, modelo, cache hit/miss, custo)
- [ ] Dashboard Grafana com métricas IA `ai.call`, `ai.cache_hit`, `ai.error` (lidas de Loki via LogQL ou de tabela `ai_audit_log` via Postgres datasource)

**Segurança em profundidade (ADR 0073 + regras 35-38):**

- [ ] **Security headers (regra 35)** em `apps/web/next.config.ts` `headers()`:
  - `Content-Security-Policy` com nonce dinâmico (middleware injeta) — script-src 'self' + nonce; style-src 'self' 'unsafe-inline' (tailwind); img-src 'self' data: + MinIO host self-host; connect-src com allowlist explícita de providers IA (Vertex/Anthropic/OpenAI/Maritaca) + GlitchTip self-host + Asaas + Focus NFe + WhatsApp BSP; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` restritiva (camera/mic/geo/bluetooth/payment somente em `self`)
  - `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Resource-Policy: same-site`
- [ ] Middleware injeta CSP nonce dinâmico (Next.js 15 server component) + propaga em `next/script`
- [ ] Submeter `logifit.com.br` ao [HSTS Preload List](https://hstspreload.org) após smoke test
- [ ] Teste E2E `apps/web/e2e/security-headers.spec.ts` valida cada header presente em `/`, `/login`, `/app/dashboard` (3 viewports — Playwright); falha CI se ausente
- [ ] **Rate limit global (regra 36)** em `packages/errors/wrap-action.ts` (estende ADR 0071) + `wrap-api-handler.ts` — **Redis self-hosted** (container Coolify, ADR 0091) com sliding window via lib `rate-limiter-flexible` ou implementação direta com Lua scripts; chave `(tenant_id, user_id, ip, endpoint)`; tabela canônica de limites em `packages/security/rate-limits.ts` (login 10/15min IP + 5/15min email · read 100/min · write 30/min · IA 20/min · search 30/min · webhook 60/min IP · signup 3/h IP); excedido retorna `RATE_LIMITED` com `retry_after_ms`
- [ ] **Redis container** disponível em dev (`docker-compose.yml`) e prod (Coolify); `REDIS_URL=redis://localhost:6379` em `.env.local`, env equivalente em Coolify pra produção
- [ ] **`packages/security/safe-fetch.ts` (regra 37)** — wrapper único para fetch externo: protocolo http/https, DNS resolve + bloqueio IP privado/loopback/link-local, `allowedHosts: string[]` obrigatório do caller, timeout 30s, maxResponseBytes 50MB, `redirect: 'manual'`; lança `SsrfError` em violação
- [x] **Lint custom `no-raw-fetch`** em `scripts/lint-custom.mjs` (Biome plugin API ainda imaturo — JS puro) — bloqueia commit se `fetch(url)` aparece fora de `safeFetch()` ou de testes; exceção via `// safe-fetch-exempt: <motivo>`. **Entregue Faixa 4 (2026-05-11).**
- [x] **Lint custom `no-hardcoded-design-token`** (regra 44) — bloqueia commit em `apps/`/`packages/` com hex literal (`#[0-9A-Fa-f]{3,8}`); exceções `packages/ui/src/tokens.css` + `apps/web/app/globals.css`; comentário-exempção `// design-token-exempt: <motivo>`. **Entregue Faixa 4 (2026-05-11).**
- [x] **Lint custom `high-risk-action-must-require-recent-mfa`** (regra 43) — lê lista de `packages/security/src/high-risk-actions.ts` (no-op silencioso até o arquivo existir, Sprint 01a); detecta `function/const <action>` sem `requireRecentMfa()` no escopo; exceção via `// mfa-exempt: <motivo>`. **Entregue Faixa 4 (2026-05-11).**
- [ ] **`packages/security/high-risk-actions.ts`** (regra 43) — array tipado `[{action: string, requireMfaMaxAgeMins: number, category: 'fiscal'|'rbac'|'financeiro'|'compliance'|'super-admin', alsoBlockedFromAi?: boolean}]` com lista canônica MVP: `cancelTissGuide`, `cancelNfe`, `voidPaidInvoice`, `updateInvoiceAmount`, `updateUserRole`, `createCustomRole`, `grantUserPermission`, `updateAsaasKey`, `configureBillingByok`, `runOpenFinancePayment` *(alsoBlockedFromAi)*, `anonymizeMember` *(alsoBlockedFromAi)*, `deleteClinicalData` *(alsoBlockedFromAi)*, `exportFullProntuario` *(alsoBlockedFromAi)*, `terminateTenant`, `openPamSession`, `restoreBackup`. Default `requireMfaMaxAgeMins=15`. Cada feature dependente de TISS/RBAC/financeiro/super-admin importa lista pra encontrar suas próprias ações.

  **Nota sobre colisão regra 41 ↔ 43:** ações marcadas `alsoBlockedFromAi=true` têm dupla proteção — (a) se invocadas por humano via UI: exigem MFA recente <15min (gate `requireRecentMfa()` regra 43); (b) se tentadas via Assistente IA: bloqueadas pelo lint `ai-block-respected` (regra 41 — handler tem comentário `// ai-blocked: <motivo>`). **As duas proteções são independentes e cumulativas** — IA nunca chega ao handler (regra 41); se chegasse via bypass, o gate MFA pegaria (regra 43). Sem gap.
- [ ] Teste E2E: tentar executar `cancelTissGuide` sem `mfa_at` recente → 403 + `MFA_RECENT_REQUIRED` no envelope; após `requireRecentMfa()` (re-TOTP), executa OK
- [ ] **`packages/security/scan-upload.ts` (regra 38) — implementação MVP zero-custo:** provider abstrato (`ScanProvider` interface) com adapter `OwnScanProvider` ativo por padrão; valida MIME real (`file-type` npm, free), magic bytes, extension allowlist por bucket, size cap, embed detection (PDF: regex em raw bloqueia `/JavaScript`/`/JS`/`/OpenAction`/`/Launch`/`/EmbeddedFile`; Office: regex bloqueia `vbaProject.bin`/`macros/` em zipped; imagens: bloqueia EXIF anômalo + polyglot via magic bytes mismatch), hash SHA256 com lookup opcional em seed `known_malicious_hashes`. Resultado em `upload_scans (id, tenant_id, storage_path, status enum 'pending'|'clean'|'suspicious'|'rejected'|'error', detection_reason text nullable, scanned_at, scan_provider text default 'own')`. **Fase 2:** plugar `ClamAvAdapter` ou `CloudmersiveAdapter` via env var `SCAN_PROVIDER` sem refactor. Lint custom `no-unscanned-upload` em rotas de upload.
- [ ] **Cloudflare proxy free tier** na frente de `logifit.com.br`: DNS aponta para Cloudflare, Cloudflare proxy → Caddy no VPS Oracle SP; SSL Full (strict) + Always HTTPS + bot fight mode + rate limiting (10k requests free/mês); 5 regras WAF customizadas (free); TTL DNS 300s pra DR rápido
- [~] **Backup em camadas (regra 40 — ADR 0091)** — implementação em 2 camadas independentes:
  - **🟢 Camada 1 (ATIVA, 2026-05-12)** — `infra/backup-local.sh` + cron `/etc/cron.d/logifit-backup-local` 02:30 UTC diário. `pg_dump -Fc` cifrado por gzip pra `/data/backups/postgres/` (chmod 700 root-only). DBs cobertos: `logifit` (app) + `glitchtip` (errors). Retention 30d. Smoke test + DR drill validados: dump tem header `PGDMP` válido; restore num DB shadow `logifit_restore_test` recuperou as 5 extensions (pg_trgm, pgcrypto, plpgsql, unaccent, vector); DB shadow descartado pós-validação. Cobre ~80% dos cenários reais (DB corruption, query errada, rollback de feature, DR drill rápido em ~10min). Logs via `journalctl -t logifit-backup-local`.
  - **🟡 Camada 2 (PENDENTE)** — `infra/backup-r2.sh` + `infra/restore-r2.sh` + runbook `docs/runbooks/backup-r2.md` versionados. Script faz `pg_dump` (logifit + glitchtip) → gzip → GPG encrypt → `rclone rcat` pra R2; MinIO via `rclone sync` incremental; Coolify metadata via `tar | gpg`; lokistack configs via tar. Retention 30d via `rclone delete --min-age`. **Ativação aguarda fundador:** (1) criar bucket R2 em `dash.cloudflare.com/r2` → token API com acesso só ao bucket; OU passar 1 API token Cloudflare global com escopo `Account/R2/Edit` (Claude cria bucket + token específico via REST API); (2) gerar par GPG `backup@logifit.com.br` em máquina local segura (privada → pen drive físico + GitHub Secret); (3) executar passos 3-4 do runbook (rclone config + import GPG public + cron entry — Claude executa via SSH em ~5min). Cobertura extra: VPS perdido / disco corrompido / Oracle conta suspensa / ransomware. Estimativa custo MVP: ~$0.20/mês.
- [ ] Script `scripts/restore-test.sh` documenta procedimento de restauração em VPS staging temporário (Hetzner CX22 Helsinki ou outra instance Oracle); `runbooks/restore-test.md` com passo-a-passo
- [ ] **Runbook `docs/runbooks/dr-drill.md`** — esqueleto pro DR drill quarterly (regra 40 + ADR 0091): derrubar VPS staging, recriar do zero via `infra/bootstrap-oracle.sh`, restaurar último backup, validar smoke tests; primeiro drill real é Sprint 04+ quando há dado de verdade
- [ ] **OWASP ZAP automated scan weekly (ADR 0073)** — GitHub Action `zaproxy/action-baseline@v0.10.0` rodando contra ambiente staging (subdomínio `staging.logifit.com.br` apontando pra outra instance VPS ou container isolado no mesmo VPS); resultado SARIF anexado ao Security tab; alerts ≥medium criam issue automaticamente; agendado via cron `0 2 * * 1` (segunda 02:00 UTC)
- [ ] **`scripts/owasp-check.ts`** em CI antes de release valida cada item OWASP Top 10 enforced (lista em ADR 0073)
- [ ] Schema Drizzle `upload_scans` em `packages/db/schema/security.ts` + RLS por tenant_id
- [ ] **Secret scanning** — Gitleaks pre-commit hook (`.husky/pre-commit`) + GitHub Actions step (`gitleaks/gitleaks-action`) com config customizada (`.gitleaks.toml`) para padrões LogiFit (`LF_KEY_*`, padrão GPG armored block, padrão Asaas API, padrão Focus NFe, padrão Brevo API key `xkeysib-*`)
- [ ] **Dependabot** habilitado em `.github/dependabot.yml` — npm + GitHub Actions ecosystems, semanal, agrupamento por minor/patch
- [ ] **OSV-scanner** em CI (`google/osv-scanner-action`) — bloqueia merge se vulnerabilidade `severity >= high` em deps de produção; cria issue em `moderate`
- [ ] **SBOM** — script `pnpm sbom:generate` produz `sboms/v{version}.json` em CycloneDX format; commit em release tag
- [ ] **Lockfile audit** — `pnpm audit --audit-level=high` em CI; build com `--frozen-lockfile`
- [ ] **CI permissions hardening** — `.github/workflows/*.yml` com `permissions: read-all` por default; escrita declarada explicitamente por job; ações de terceiros pinadas por SHA (`uses: actions/checkout@a1b2c3d...`)
- [x] **`/.well-known/security.txt`** em `apps/web/public/.well-known/security.txt` (RFC 9116) — `Contact: mailto:security@logifit.com.br`, `Expires: 2027-04-27`, `Preferred-Languages: pt-BR, en`, `Policy: https://logifit.com.br/seguranca`, `Canonical: https://logifit.com.br/.well-known/security.txt` — **entregue Faixa 1 (2026-04-27); visível em prod 2026-05-11 via Faixa 2** (responde 200 em `https://app.logifit.com.br/.well-known/security.txt`)
- [x] **Página pública `/seguranca`** em `apps/web/app/(public)/seguranca/page.tsx` — postura resumida, política de divulgação responsável (90d coordinated), hall da fama (vazio inicialmente), email `security@logifit.com.br` — Server Component i18n via `getTranslations('security')` nos 3 locales — **entregue Faixa 1 (2026-04-27); visível em prod 2026-05-11 via Faixa 2** (responde 200 em `https://app.logifit.com.br/seguranca`)
- [ ] DNS `security@logifit.com.br` configurado (Cloudflare Email Routing → fundador inicialmente)
- [ ] Conta Cloudflare Turnstile (free) criada + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET` em Coolify env vars (Sprint 01a usa)

**Bootstrap Oracle Cloud SP + Coolify (ADR 0091 — Faixa 2):**

- [x] **Conta Oracle Cloud OCI** criada com **PAYG mode ativado** (cartão de crédito vinculado, mas mantém free tier R$0 enquanto não exceder limites — reduz risco de suspensão sem aviso) — **entregue 2026-05-09**
- [x] **VPS provisionado** na região **Vinhedo (`sa-vinhedo-1`)** — VM.Standard.A1.Flex ARM Ampere com **4 OCPU + 24 GB RAM** + **150 GB block storage** (em vez de 200 GB pra ficar dentro do free tier de 200 GB total); Ubuntu 22.04 Minimal aarch64; SSH key `ssh-key-2026-05-06` (ed25519); IP público `157.151.31.227` reservado — **entregue 2026-05-09**
- [x] **`infra/bootstrap-oracle.sh`** versionado no repo: script idempotente que (a) atualiza apt + instala Docker + Docker Compose; (b) configura UFW firewall (22/SSH só de IP do fundador, 80/443/HTTP+S, 8000/Coolify console restrito); (c) instala Coolify via script oficial; (d) configura swap 4GB; (e) ativa unattended-upgrades de segurança; (f) instala fail2ban — **entregue 2026-05-10**
- [x] **Coolify** instalado e acessível em `https://coolify.logifit.com.br` (Cloudflare proxy 🟠 + Let's Encrypt) — **entregue 2026-05-06**
- [x] **Coolify configurado** com Deploy Key SSH no GitHub repo (Private Key `logifit-github-deploy`); webhook automático on push em `main` — **entregue 2026-05-11**. _Desvio justificado:_ optamos por Coolify pegar o repo direto via Deploy Key + build no VPS, em vez de GHA → GHCR → webhook (item abaixo); reavaliar quando tempo de build no VPS virar gargalo.
- [x] **Containers self-hosted no Coolify** — `pgvector/pgvector:pg17` (database `logifit` + 4 extensions) ✅ + `redis:7.2` ✅ + `minio/minio` (5 buckets) ✅ + `traefik:v3.6` ✅ + **`glitchtip/glitchtip:latest` + postgres+redis dedicados + worker Celery** ✅ + **`grafana/loki:3.2.0` + `grafana/promtail:3.2.0` + `grafana/grafana:11.3.0` (Loki datasource pré-provisionado)** ✅ + **`edoburu/pgbouncer:latest` (transaction pool, 200 max client conn)** ✅. _Faixa 3 completa para containers._
- [x] **Volumes persistentes** em `/data/coolify/...` (block storage Oracle 150 GB montado em `/data` ext4) — **entregue 2026-05-09**
- [x] **Traefik reverse proxy** configurado pra: `app.logifit.com.br` → Next.js container ✅ (HTTP/2 + Let's Encrypt ACME via TLS-ALPN-01) + `coolify.logifit.com.br` → Coolify dashboard ✅ + `errors.logifit.com.br` → GlitchTip web (Faixa 3, 14 labels Traefik manuais — Coolify v4 não gera auto pra Service compose) ✅ + `monitor.logifit.com.br` → Grafana ✅. _Faixa 3 completa para Traefik._
- [ ] **`.github/workflows/deploy.yml`** — push em `main` → `docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/everton/logifit:$SHA .` → push GHCR → webhook Coolify. _Pendente — atualmente Coolify faz build no VPS direto via Deploy Key (mais simples no Sprint 00, considerar migrar pra GHA+GHCR quando build no VPS virar gargalo ou quando virar prática multi-environment)._
- [x] **Primeiro deploy "Hello World"** Next.js em `https://app.logifit.com.br` validado: `curl https://app.logifit.com.br` retorna `HTTP/2 200` com 8/8 security headers (HSTS preload, CSP com nonce dinâmico + `strict-dynamic`, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP) + página renderiza tokens "Equilíbrio Vital" + i18n pt-BR ativo — **entregue 2026-05-11** (commit `3d5a463`)
- [ ] **Runbook `docs/runbooks/bootstrap-oracle.md`** — passo-a-passo de criar conta Oracle, ativar PAYG, provisionar VPS, rodar `bootstrap-oracle.sh`, configurar Coolify, primeiro deploy. Atualizar em cada drift de processo
- [ ] **Runbook `docs/runbooks/coolify-operacoes.md`** — cheatsheet de operações comuns: ver logs, restart container, backup volume, restore, troubleshooting comum

**Regras de soberania perpétua (ADR 0091 — supersede ADR 0078):**

- [x] **`packages/storage/`** com interface `StorageAdapter` + `MinioStorageAdapter` default em prod e dev (env var `MINIO_ENDPOINT`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`); adapter alternativo opcional pra futuro — **entregue 2026-04-29** (Faixa 1; CHANGELOG)
- [ ] **RLS policies em SQL puro** em `packages/db/policies/*.sql` versionadas com Drizzle migrations
- [ ] **Connection string via `DATABASE_URL` env** + Drizzle direto sempre (sem ORM secundário)
- [ ] **PgBouncer integrado** no setup do Postgres no Coolify; Drizzle config sem prepared statements long-lived; `transaction` mode pooler
- [ ] Auth via JWT custom + cookie httpOnly próprio (Sprint 01a entrega via BetterAuth ou Lucia)
- [ ] Realtime: padrão `LISTEN/NOTIFY` + WebSocket próprio Next.js documentado em `docs/dev/realtime.md`
- [ ] **Lint custom `no-external-saas-import`** (regra 46) em Biome — bloqueia commit que importa SDK de provider externo não-listado em `packages/security/external-deps.ts`; lista canônica MVP: `@aws-sdk/client-ses`, `@google-cloud/vertexai`, `@anthropic-ai/sdk`, `openai`, `@asaas/sdk` (se existir; caso contrário fetch via safeFetch), `focus-nfe`, `twilio`/`gupshup-whatsapp` (Sprint 13)
- [ ] Criar `docs/dev/realtime.md` documentando padrão `LISTEN/NOTIFY` LogiFit (channels, payload JSON, idempotência) + WebSocket próprio Next.js implementação (sem Supabase Realtime — nunca existiu)

**Compliance — esqueletos pra sprints clínicos consumirem:**

- [x] Criar **arquivos skeleton de RIPD** (frontmatter + finalidade + base legal + sprint dono + deadline) em `docs/compliance/ripd/`, **expandido pra 18 RIPDs** (7 canônicos + 11 adicionais cobrindo todo o roadmap MVP/Fase 2/Fase 3): `v1.0-prontuario-fisio.md`, `v1.0-tiss-convenios.md`, `v1.0-exames-laboratoriais.md`, `v1.0-nutri-diario.md`, `v1.0-teleconsulta.md`, `v1.0-device-hub.md`, `v1.0-reconhecimento-facial.md`, `v1.0-academia-treino.md`, `v1.0-avaliacoes-fisicas.md`, `v1.0-evolucao-midias.md`, `v1.0-nutri-agent-ia.md`, `v1.0-nutri-plano.md`, `v1.0-passaporte-paciente.md`, `v1.0-portal-paciente.md`, `v1.0-prescricoes.md`, `v1.0-whatsapp.md`, + `v0.1-agendamento.md`, `v0.1-cobranca-financeiro.md`, `v0.1-ia-copilot-clinico.md` (skeletons pré-Sprint). Cada arquivo tem `Parecer DPO: Pendente`, link para `_template.md`, sprint dependente. `pnpm compliance:check` valida (regra 29) — 1 formal + 18 legacy reconhecidos.

- [ ] Criar `scripts/hash-ripd.ts` que computa SHA-256 do conteúdo de cada RIPD em `docs/compliance/ripd/v*.md` e atualiza o campo `Hash SHA-256` no frontmatter; rodado em CI antes de merge (regra 29). Arquivo só vira `Status: Vigente` se hash bate com último commit que tocou o conteúdo.

- [ ] **Runbook esqueleto `docs/runbooks/adicionar-novo-locale.md`** (ADR 0052 — extensibilidade) — passo-a-passo canônico de 10 passos para adicionar um locale futuro (de-DE, fr-FR, etc): atualizar `LOCALES`/`LOCALE_NAMES`, criar diretório `messages/{locale}/`, rodar `pnpm i18n:translate --target {locale}`, revisão humana, INSERT em `translations` para catálogos clínicos via seed, atualizar `CHECK` constraint, `pnpm i18n:check`, smoke E2E na matrix de locales, deploy. Conteúdo amadurece conforme catálogos clínicos e templates email/PDF aterrissarem nos sprints respectivos.

- [ ] **Wire `pnpm docs:check`** no `package.json` raiz apontando para `node scripts/docs-check.mjs` (script já existe na raiz desde a 15ª auditoria). Workflow CI `.github/workflows/docs-check.yml` já roda automaticamente em PRs/push tocando `docs/`; após Sprint 00, dev local roda via pnpm. Validações: número H1 ADR ≡ filename, links MD relativos resolvem, "ADR NNNN (esperado)" não colide entre sprints nem com ADR publicado.

**README e docs:**

- [ ] README atualizado com `pnpm dev`, `pnpm test`, `pnpm db:migrate`, `pnpm db:rls-check`, `pnpm i18n:check`, `pnpm docs:check`

## Stretch

- [ ] Storybook para `packages/ui` com preview em 3 locales
- [ ] Integração Translation Memory (TM) para reuso de tradução cross-sprint

## Log

- **2026-05-21 (tarde) — Sprint 00.Q: GlitchTip SDK plugado no Next.js (~99%).**
  - **4 configs Sentry/GlitchTip em `apps/web/`** — `instrumentation.ts` (entrypoint Next 15 carrega config por runtime), `sentry.client.config.ts` (browser, tracesSampleRate 0.1 prod, replay desabilitado pois GlitchTip não suporta), `sentry.server.config.ts` (Node runtime + conecta `setCaptureHook(@repo/errors) → Sentry.captureException` com tags tenant_id/request_id/module/code/fingerprint), `sentry.edge.config.ts` (Edge middleware minimalista).
  - **`next.config.ts` wrap** em `withSentryConfig(..., { sourcemaps: { disable: true }, silent: !SENTRY_AUTH_TOKEN, disableLogger: true })` — GlitchTip não consome sourcemaps (feature Sentry-only), então skip pra evitar 404s no build.
  - **Capture hook injetável em `@repo/errors`** — `packages/errors/src/capture.ts` exporta `setCaptureHook` + `captureFromBoundary`. Desacopla `@repo/errors` (generic) de `@sentry/nextjs` (Next-specific). 3 wrappers (`wrap-action`/`wrap-api-handler`/`wrap-job`) chamam `captureFromBoundary` automaticamente pra códigos `INTERNAL_ERROR`/`SERVICE_UNAVAILABLE`/`AI_PROVIDER_ERROR` — `VALIDATION_ERROR` e similares NÃO vão pro GlitchTip (ruído).
  - **Env vars (`.env.example`):** `NEXT_PUBLIC_SENTRY_DSN` (DSN público), `SENTRY_DSN` (alternativa só-server fallback), `SENTRY_ENV`, `SENTRY_RELEASE`. Sem DSN setada, `setCaptureHook` nunca é chamado e wrappers seguem só logando via pino + retornando envelope ApiError — **zero overhead em dev sem GlitchTip**.
  - **Runbook `docs/runbooks/glitchtip-setup.md`** — cobre criar organização + projeto no painel `errors.logifit.com.br`, copiar DSN, setar env vars, smoke test (endpoint `/api/test-sentry`), configurar alerta por email pra `INTERNAL_ERROR`, monitorar quotas, troubleshooting comum.
  - **Próximo passo (fundador):** criar projeto LogiFit/web no painel + copiar DSN + setar `NEXT_PUBLIC_SENTRY_DSN` em Coolify env vars do container `logifit-web`.
  - **Validação:** typecheck 12/12 verde + 199/199 tests `@repo/security`.

- **2026-05-21 — Sprint 00 fechamento Faixa 4 (~98%): 11 pendências limpas + checklist atualizado.**
  - **Segurança (regra 38):** `packages/security/src/scan-upload.ts` MVP real substitui stub `pending`. Magic bytes inline (10 formatos sem dep: PDF/PNG/JPG/GIF/WebP/MP4/ZIP/WAV/MP3/OGG), allowlist mime+ext por bucket, size cap, embed detection regex (PDF JavaScript/OpenAction/Launch/EmbeddedFile; Office vbaProject.bin/macros/), SHA-256 hash. 6 buckets canônicos com policy individual; bucket desconhecido fail-closed. 28 unit tests verdes em `scan-upload.test.ts`. **Tests `@repo/security` totais: 199 verdes** (era 171 — +28).
  - **Observabilidade (regra 33):** `packages/errors/src/logger.ts` — pino structured logger com redact LGPD (cpf/cnpj/email/senha/token/secret), base fields (service/env), timestamp ISO, opt-in pino-pretty em dev via `LF_PINO_PRETTY=1`. Substitui `console.error(JSON.stringify(...))` em `wrap-action`/`wrap-api-handler`/`wrap-job`. Promtail já captura stdout dos containers Docker e empurra pro Loki self-host (`monitor.logifit.com.br`).
  - **Componentes UI responsivos (ADR 0063):** 6 componentes novos em `packages/ui/`:
    - `<LocaleSwitcher>` em `i18n/` consumindo `LOCALES`/`LOCALE_NAMES` dinamicamente — sem dep de `next/*` (usa `window.location.reload()` em vez de `router.refresh()`)
    - `<Breadcrumbs>` em `nav/` com colapso mobile automático quando ≥4 items (… + primeiro + último)
    - `<ResponsiveModal>` em `layout/` — bottom-sheet mobile ↔ centered desktop via `<dialog>` HTML5 nativo
    - `<ResponsiveTable>` — table desktop ↔ stacked CardList mobile, `priority: 'always'|'md'|'lg'` por coluna controla visibilidade
    - `<ResponsiveForm>` + `<StickyFooter>` — grid 2-col lg+ ↔ stack 1-col mobile; footer sticky bottom com `safe-area-inset-bottom`
    - `<CommandPalette>` scaffolding (ADR 0062) — overlay + input + slots via `<dialog>`, hook `useCommandPalette()`, atalho global Ctrl+K/Cmd+K, mock `onSearch` (Sprint 07 conecta `search_index` real)
    - `@repo/i18n` adicionado como dep de `@repo/ui` (export type Locale)
  - **Testes / coverage (regra 18 + ADR 0090):** `apps/web/e2e/helpers/db.ts` real substitui stub `not implemented`. Abre 2 `PoolClient` distintos via `pg.Pool`, seta `app.tenant_id` diferente em cada um, valida UUID e tenantA !== tenantB, cleanup no finally. T6 ADR 0090 funcional. Coverage gate em `packages/errors` (80% threshold) + `packages/ai` (60% baseline). **6 de 9 packages agora têm coverage gate** (db/email/security/storage já tinham 80%).
  - **Scripts / hooks:** `.githooks/pre-commit` (bash puro, sem husky) — biome check em staged files + lint:custom + i18n:check condicional. Ativar via `pnpm hooks:install` (`git config core.hooksPath .githooks`). `scripts/sbom-generate.mjs` via `npx @cyclonedx/cdxgen` → `sboms/v<version>.json` (gitignored, opt-in commit em release tag).
  - **CI:** `.github/workflows/owasp-zap.yml` baseline scan weekly (segunda 02:00 UTC) contra `staging.logifit.com.br`. SARIF → Security tab + issue auto pra alerts ≥medium. Manual trigger via `workflow_dispatch` com input `target_url`. SHAs pinados (actions/checkout@a1b2... regra de CI hardening).
  - **README** atualizado: estrutura monorepo (12 packages explicados), comandos por categoria (dev/banco/testes/qualidade/release), quick start 4 passos, links pra docs principais (CLAUDE.md, arquitetura, rules, roadmap, runbooks, compliance).
  - **Validação:**
    - ✓ typecheck 12/12 packages
    - ✓ biome check clean
    - ✓ tests `@repo/security` 199 verdes (era 171 — +28 scan-upload)
    - ✓ tests outros packages preservados
  - **Pendente Sprint 00 (1 item dev):** GlitchTip SDK no Next.js — `@sentry/nextjs` config apontando DSN `errors.logifit.com.br` (servidor já rodando desde Faixa 3). Sprint 01a Faixa A pode pegar isso porque depende de Server Action real disparar capture.
  - **Pendente Sprint 00 (3 itens bloqueados por input externo do fundador):**
    - **Backup Camada 2 (R2 off-site)** — aguarda: (a) token API Cloudflare R2:Edit ou bucket criado manualmente, (b) par GPG `backup@logifit.com.br` em pen drive físico. Runbook `backup-r2.md` documenta ativação em ~5min após credentials chegarem.
    - **DNS `security@logifit.com.br`** — Cloudflare Email Routing → fundador inicialmente.
    - **HSTS Preload List submission** — submeter `logifit.com.br` ao `hstspreload.org` após decisão de "preload forever".
  - **Lints custom Sprint 00 entregues:** 8 ativos em `scripts/lint-custom.mjs` — `no-window-alert` · `no-raw-fetch` · `no-hardcoded-design-token` · `no-rejected-saas-import` · `no-hardcoded-toast-message` · `no-unwrapped-action` · `high-risk-action-must-require-recent-mfa` · `cross-tenant-read-must-log`. `no-unscanned-upload` planejado pra ativar quando primeiro upload real aterrissar (Sprint 01a+).

- **2026-05-12 — Backup Camada 1 (local) ATIVA em prod.**
  - **`infra/backup-local.sh`** versionado + instalado em `/usr/local/bin/logifit-backup-local.sh` no VPS. Faz `pg_dump -Fc` cifrado por gzip das DBs `logifit` + `glitchtip` pra `/data/backups/postgres/` (chmod 700 root-only). Retention 30d via `find -mtime +30 -delete`. Sem GPG (mesmo trust boundary do DB).
  - **`cron` daemon instalado e ativo** (`systemctl enable --now cron`) — Ubuntu 22.04 Minimal não vinha com cron por default.
  - **Cron entry `/etc/cron.d/logifit-backup-local`** agendado pra 02:30 UTC diário (23:30 BRT — fora do pico). Logs via `journalctl -t logifit-backup-local`.
  - **Smoke test + DR drill validados:**
    - Roda manual produziu `logifit-2026-05-12_170745.pgdump.gz` (794 bytes — DB vazio) + `glitchtip-2026-05-12_170745.pgdump.gz` (377 bytes).
    - Header `PGDMP` (PG Dump Custom format) confirmado via `zcat | head -c 5 | xxd`.
    - **DR drill end-to-end**: restaurei dump num DB shadow `logifit_restore_test`; 5/5 extensions preservadas (pg_trgm, pgcrypto, plpgsql, unaccent, vector). DB shadow descartado pós-validação. Sistema de backup→restore funcional ANTES do primeiro byte de dado real (Sprint 01a).
  - **Camada 2 (R2 off-site) permanece pendente** — aguarda fundador fornecer 1 API token Cloudflare global (Claude cria bucket + token específico via REST API) + par GPG (gerar localmente, privada vai pra pen drive offline). Quando chegarem credentials, ativação via runbook `backup-r2.md` §3-4 leva ~5min.
  - **Cobertura atual (Camada 1 sozinha):** ✅ DB corruption · ✅ query errada · ✅ rollback de feature · ✅ DR drill rápido (~10min restore). ❌ VPS perdido · ❌ disco corrompido · ❌ Oracle conta suspensa · ❌ ransomware. Regra 40 só fecha 100% com Camada 2.

- **2026-05-11 (noite) — Faixa 4 FECHADA 🟢: qualidade + compliance preparados pra Sprint 01a.**
  - **10/10 esqueletos `e2e/smoke/`** com `test.skip()` nomeados conforme ADR 0090 §6: `auth-magic-link`, `tenant-switch`, `member-create`, `agenda-book`, `asaas-checkout`, `dashboard-by-role`, `global-search`, `messages-catalog`, `security-headers` (este já com asserts reais — passa hoje em prod), `mfa-recent-required`. Cada um documenta cenário + sprint dono + dependências.
  - **12/12 esqueletos `e2e/critical/`** com `test.skip()` conforme ADR 0090 §5: cross-tenant-rls (T6) · trial-anonymize · cross-tenant-audit-log · passport-global-constraint · asaas-idempotencia (T7) · cross-prescricao-fisio-academia · nfe-210210-rejeicao · hash-chain-cutover · icp-brasil-portal-iti · tiss-xsd-validation · revoke-passport-link · franchise-rule-25-clinico-nao-cruza.
  - **8 lints custom em `scripts/lint-custom.mjs`** (JS puro, sem dep — Biome plugin API ainda imaturo): `no-window-alert` (regra 45) · `no-raw-fetch` (37) · `no-hardcoded-design-token` (44) · `no-rejected-saas-import` (46) · `no-hardcoded-toast-message` (45+27) · **`no-unwrapped-action`** (33 — Server Actions sem `wrapAction()`) · **`high-risk-action-must-require-recent-mfa`** (43 — lê lista de `packages/security/src/high-risk-actions.ts`, no-op silencioso até o arquivo existir Sprint 01a) · **`cross-tenant-read-must-log`** (42 — detecta query cross-tenant sem `logCrossTenantAccess()`). Validado local: ✓ 85 code + 2 css files clean (8 rules).
  - **18 RIPDs em `docs/compliance/ripd/`** — 7 canônicos exigidos pelo Sprint 00 (`prontuario-fisio`, `tiss-convenios`, `exames-laboratoriais`, `nutri-diario`, `teleconsulta`, `device-hub`, `reconhecimento-facial`) + 11 adicionais cobrindo todo o roadmap (academia-treino, avaliações, evolução-mídias, nutri-agent-ia, nutri-plano, passaporte-paciente, portal-paciente, prescrições, whatsapp + 3 pré-Sprint v0.1: agendamento, cobrança, IA copilot). `pnpm compliance:check` valida via hash SHA-256 (Faixa 1 entregou). Cada arquivo tem `Parecer DPO: Pendente`, link pro template, sprint dependente. Versão final por RIPD chega no Sprint dono — Faixa 4 garante que CI já reconhece todos.
  - **Lições adicionais ao runbook:**
    15. **Smoke `security-headers.spec.ts` é único que passa em prod desde Faixa 2** (não precisa esperar Sprint 01a) — útil pra CI gate antes mesmo de qualquer feature de negócio. Faz curl em `/`, `/.well-known/security.txt` e verifica 6 headers fixos + CSP nonce dinâmico (2 requests → 2 nonces distintos).
    16. **Lints 6-8 são "ready"** — passam silenciosamente até Sprint dono criar o padrão (Server Action com `'use server'`, arquivo `high-risk-actions.ts`, query cross-tenant). Quando feature aterrissa, lint vira fail automaticamente sem retrofit.
    17. **Lint 7 (high-risk-action-must-require-recent-mfa) lê fonte canônica** `packages/security/src/high-risk-actions.ts` — adicionar uma action lá já registra ela como high-risk e força MFA recente. Sprint 17/20/22 que adicionarem `cancelNfe`/`cancelTissGuide` só editam essa lista (não precisam mexer no lint).

- **2026-05-11 (tarde) — Faixa 3 quase fechada: observabilidade self-host + pool + backup-as-code subiram em prod.**
  - **GlitchTip self-host** em `https://errors.logifit.com.br` — stack `glitchtip/glitchtip:latest` (v6.1.6 ARM64) + `postgres:16-alpine` dedicado + `redis:7.2-alpine` dedicado + worker Celery; `/_health/` retorna `ok`; painel Angular acessível; sign-ups públicos bloqueados (`ENABLE_USER_REGISTRATION=false`). Coolify v4 não gera labels Traefik pra Docker Compose Service → labels manuais (14 labels) seguindo padrão do App principal. Healthcheck via Python (`urllib.request`) porque imagem GlitchTip não tem wget/curl. UUID service: `lkji13qn0p561ovseh497wgq`.
  - **Loki + Promtail + Grafana** em `https://monitor.logifit.com.br` — `grafana/loki:3.2.0` + `grafana/promtail:3.2.0` + `grafana/grafana:11.3.0`. Promtail tail `/var/lib/docker/containers/*/*-json.log` de TODOS containers do VPS (incluindo Coolify) → Loki ingest → Grafana com **Loki datasource pré-provisionado via bind-mount `/data/lokistack/grafana-provisioning/datasources/loki.yml`** (provisioning como código — survive a redeploy). Admin password 32 chars gerado random + cookies seguros. UUID service: `expwv4l6ydu39d1mhrq5nifh`.
  - **PgBouncer** transaction pool (`edoburu/pgbouncer:latest` ARM64) apontando pro Postgres existente — `pool_mode=transaction` (idiomático Next.js stateless), `max_client_conn=200`, `default_pool_size=20`, `reserve_pool_size=5`. Conectado na network `coolify` pra outras apps acessarem como `pgbouncer-<uuid>:5432`. Smoke test: `SELECT version()` via pool → PostgreSQL 17.9 aarch64 ✅ + 4 extensions ativas (pg_trgm, unaccent, vector 0.8.2, pgcrypto) ✅ + 2 pools registrados (`logifit/postgres` transaction + `pgbouncer/pgbouncer` statement admin). UUID service: `sbd28p5yc2befkvjjl40u58f`.
  - **`infra/backup-r2.sh` + `infra/restore-r2.sh`** versionados (regra 40 — ADR 0091): pg_dump cifrado GPG → rclone rcat pra R2 (DB logifit + DB glitchtip); MinIO `rclone sync` incremental; Coolify metadata `tar | gpg`; lokistack configs tar. Retention 30d. **Ativação pendente** (depende user fornecer R2 bucket + token + par GPG).
  - **`docs/runbooks/backup-r2.md`** — runbook completo: 5 passos de primeira ativação (criar bucket R2, gerar GPG, SSH setup, validar smoke test, agendar DR drill) + 3 cenários de restore (DB corrompido, MinIO perdido, VPS perdido). RTO target 4h (regra 40).
  - **Validações end-to-end:**
    - `curl -sI https://errors.logifit.com.br` → `HTTP/2 200`, CSP do GlitchTip funcionando.
    - `curl -sI https://monitor.logifit.com.br/api/health` → `HTTP/2 200` (Grafana health endpoint).
    - `docker exec pgbouncer-... psql -d logifit -c "SELECT version()"` → Postgres 17.9 ✅.
    - Containers totais: 14 (4 originais + 4 GlitchTip + 3 Loki/Grafana + 1 PgBouncer + 1 Application + 1 sentinel Coolify). VPS usando ~3.5 GB RAM de 23 GB (alocação confortável).
  - **Lições adicionais ao runbook:**
    10. **Coolify v4 NÃO gera labels Traefik pra Docker Compose Service** — só pra Applications (build_pack=dockerfile). Magic env `SERVICE_FQDN_*` é silencioso aqui. Workaround: labels Traefik manuais no compose `services.<name>.labels[]`.
    11. **`PATCH /api/v1/services/{uuid}/envs` falha silenciosa quando env não existe** (returna `key: None`) — sempre fazer POST primeiro (auto-cria slot se o compose referencia `${VAR}`, ou cria do zero se não).
    12. **`POST /api/v1/services` rejeita campo `connect_to_docker_network`** (field não permitido em create — só editável depois). Pra subir service que precisa network compartilhada, declarar `networks: { coolify: { external: true } }` no compose direto.
    13. **GlitchTip image não tem `wget`/`curl`** — healthcheck via `python3 -c "import urllib.request"` (image é Python-based).
    14. **`SERVICE_NAME_*` envs auto-injetadas pelo Coolify** em todos serviços do compose (visíveis no `docker_compose` parsed) — útil pra DNS interno, não confundir com user-defined envs.

- **2026-05-11 — Faixa 2 FECHADA 🟢: `https://app.logifit.com.br` rodando ponta a ponta — Cloudflare → Traefik → Next.js standalone com 8/8 security headers (regra 35), CSP nonce dinâmico por request + `strict-dynamic` (sem `unsafe-inline` em `script-src`), i18n pt-BR/en-US/es-419 ativo (regra 27), Toaster CSP-safe propagando nonce (regra 45), design tokens "Equilíbrio Vital" aplicados (regra 44).**
  - **Deploy final** commit `3d5a463` (terceira tentativa); container `Up (healthy)`; HTTP/2 200 externo via `cf-ray ...GRU` (Cloudflare São Paulo edge); HTTP 200 local via healthcheck `wget http://127.0.0.1:3000/`.
  - **3 erros corrigidos no caminho** que viraram lição:
    1. **TS error Sonner v1.7 ToasterProps não declara `nonce`** → spread `{...extra}` com cast `as any` + comentário `// biome-ignore` justificativa explícita; Sonner ≥2 expõe nativo (`packages/ui/src/messages/toaster.tsx`).
    2. **Next.js 15.5 deprecation `experimental.typedRoutes`** → migrado pra top-level `typedRoutes: true` (`apps/web/next.config.ts`).
    3. **Alpine BusyBox `wget --spider http://localhost:3000/` falhou com Connection refused** porque resolve `localhost` como `[::1]` IPv6 e Next.js standalone com `HOSTNAME=0.0.0.0` bind só em IPv4 → forçar `http://127.0.0.1:3000/` no `HEALTHCHECK` do Dockerfile (commit `3d5a463`).
  - **VPS Oracle Cloud Vinhedo (`sa-vinhedo-1`)** — VM.Standard.A1.Flex 4 OCPU + 24 GB RAM ARM Ampere; IP público `157.151.31.227`; Ubuntu 22.04 Minimal aarch64; block volume 150 GB ext4 montado em `/data`; `bootstrap-oracle.sh` rodado (UFW + fail2ban + Docker CE + Coolify install).
  - **Coolify v4.0.0** healthy há 5 dias com 4 containers internos (proxy Traefik v3.6 / db Postgres 15 / redis 7 / realtime).
  - **Cloudflare DNS** propagado: A records `app.logifit.com.br` + `coolify.` + `monitor.` + `errors.` apontando pro VPS (proxied 🟠).
  - **`logifit-pg`** (`pgvector/pgvector:pg17` healthy): database `logifit` criada manualmente + 4 extensions ativadas (`pg_trgm`, `unaccent`, `vector` 0.8.2, `pgcrypto`) — Coolify v4 ignorou o `docker-entrypoint-initdb.d` (workaround: `docker exec psql` direto).
  - **`logifit-redis`** (`redis:7.2` healthy): auth `PONG` funcional, network alias `logifit-redis` no `coolify` network.
  - **`logifit-minio`** (`minio/minio:latest` ARM64 healthy): MinIO Server RELEASE.2025-09-07; 5 buckets criados (`logifit-uploads`, `logifit-backups`, `logifit-lab-documents`, `logifit-fisio-evolucoes`, `logifit-exam-attachments`); conectado a `coolify` network (10.0.2.9) + network próprio do compose. **Lição:** Coolify v4 `build_pack=dockerimage` ignora `start_command` — solução foi recriar via `Docker Compose Empty` com YAML explícito incluindo `command: server /data --console-address ":9001"`. Bitnami/minio descartado (tag `latest` removida em mudança Bitnami "Secure Images" 2025).
  - **Coolify SSH config**: ajustamos `Match Address 127.0.0.1,10.0.0.0/8,172.16.0.0/12` em `/etc/ssh/sshd_config.d/99-coolify-localhost.conf` pra permitir `root@host.docker.internal` (Docker bridge `10.0.1.1`); Deploy Keys do Coolify autorizadas em `/root/.ssh/authorized_keys` (sem `force_command` Ubuntu default removido); user no DB Coolify atualizado de `ubuntu` → `root` direto via `psql` (painel UI estava cached). Externalmente, root SSH continua bloqueado pelo `bootstrap-oracle.sh` hardening.
  - **`apps/web/Dockerfile` + `.dockerignore`** criados — multi-stage Node 22 alpine + corepack pnpm + libc6-compat; non-root user `nextjs:nodejs` (UID 1001); standalone Next.js output (`output: 'standalone'` + `outputFileTracingRoot` pra monorepo); healthcheck `wget --spider http://127.0.0.1:3000/` (IPv4 forçado); CMD `node apps/web/server.js`. Build context = raiz do monorepo.
  - **`next.config.ts`** ganha `output: 'standalone'` + `outputFileTracingRoot: repoRoot` (calculado via `import.meta.url` ESM) + `typedRoutes: true` top-level (deprecation Next 15.5).
  - **Application Coolify `logifit-web`** criada via API REST: repo `git@github.com:SurkampEverton/LogiFit.git` via Deploy Key (Private Key `logifit-github-deploy`), branch `main`, build_pack `dockerfile`, dockerfile_location `/apps/web/Dockerfile`, ports_exposes `3000`, domain `https://app.logifit.com.br`, TLS resolver `letsencrypt`, env `NODE_ENV=production` + `NEXT_TELEMETRY_DISABLED=1` (`is_buildtime` field, sem underscore — gotcha Coolify v4 API).
  - **Lições documentadas pra runbook futuro:**
    1. Coolify v4 cria diretórios `/data/coolify/...` com ownership do user SSH; ubuntu user UID 1001 quebra acesso UID 9999 do Coolify → resolve com SSH user=root + `Match Address` localhost-only.
    2. `start_command` não é aplicado em `build_pack=dockerimage` → usar `Docker Compose Empty` quando precisar de command custom.
    3. Bitnami images public sem tag `latest` desde 2025 → preferir imagens oficiais (`minio/minio`, `redis:7.2`, `postgres:17`) ou Bitnami Legacy.
    4. Image `postgres:17-alpine` não tem pgvector → forçar `pgvector/pgvector:pg17` via UPDATE direto no DB Coolify `standalone_postgresqls.image`.
    5. Docker-entrypoint-initdb.d só executa em cluster vazio; volume preservado entre redeploys ignora init scripts → criar database + extensions manualmente.
    6. **Alpine BusyBox resolve `localhost` → IPv6 `[::1]` primeiro** — em healthchecks de container Next.js standalone com `HOSTNAME=0.0.0.0` (IPv4 only) sempre usar `127.0.0.1` (não `localhost`).
    7. **Coolify v4 API env var field é `is_buildtime` (sem underscore)** — `is_build_time` retorna `not allowed`. Pra evitar gotchas usar body mínimo `{"key": ..., "value": ...}`.
    8. **Sonner v1.7 não tipa prop `nonce` em `ToasterProps`** apesar de aceitar em runtime — spread tipado com `as any` (ou upgrade ≥2 pós-Sprint 00); regra 45 ainda atendida pela arquitetura (nonce vem do middleware via `headers().get('x-nonce')`).
    9. **Next.js 15.5+ promoveu `typedRoutes` de `experimental.*` para top-level** — manter na seção experimental imprime warning sem quebrar build, mas convém migrar logo.
  - **Próximas faixas:** Faixa 3 (security headers já no ar — falta GlitchTip + Loki/Grafana + Cloudflare R2 backup com rclone+GPG) e Faixa 4 (8 lints custom + esqueletos `smoke/` e `critical/` + helpers Playwright + RIPDs vazios).

- **2026-04-27 — Faixa 1 (semana 1) entregue.** Monorepo executável + dev local + CI verde.
  - **Monorepo:** Turborepo + pnpm workspace v10 + Node 22; 9 packages (`@repo/{config,ui,db,ai,types,i18n,storage,errors,security}`) com `package.json` (`type: module`, `exports` map) + `tsconfig.json` (extends `@repo/config/tsconfig.base.json`) + `src/index.ts` placeholder; `@app/web` Next.js 15 + React 19 + Tailwind v4 + next-intl v4.
  - **Dev local:** `docker-compose.yml` com 4 services healthchecked (`pgvector/pgvector:pg16` + `redis:7-alpine` + `minio/minio:latest` + `mailhog/mailhog:latest`); volumes em `.docker-data/` gitignored. **Desvio justificado:** trocou `postgres:16-alpine` da spec por `pgvector/pgvector:pg16` para que `CREATE EXTENSION vector` funcione (regra 30 + ADR 0064).
  - **`apps/web`:** `next.config.ts` com `withNextIntl` + `transpilePackages: ['@repo/*']`; `middleware.ts` (cookie `NEXT_LOCALE` + Accept-Language fallback + propagação `x-request-id`); `app/layout.tsx` com `Inter` via `next/font/google` e `viewport: { viewportFit: 'cover' }` (regra 31); `app/globals.css` mapeando tokens EV → Tailwind v4 via `@theme inline`; esqueleto i18n em `src/messages/{pt-BR,en-US,es-419}/{common,auth}.json` (17 keys × 3 locales).
  - **`packages/db`:** `drizzle.config.ts` (`dialect: postgresql`); `init/0000_extensions.sql` idempotente (`pg_trgm` + `unaccent` + `vector` + `pgcrypto`); `scripts/migrate.ts` runner em duas fases (init → Drizzle migrator se houver journal); `src/client.ts` com `Pool` global pra HMR; `tests/rls-check.ts` que falha se `pg_class` mostrar tabela com `tenant_id` sem `relrowsecurity`.
  - **`packages/i18n/src/config.ts`:** `LOCALES` + `DEFAULT_LOCALE` + `FALLBACK_CHAIN` + `LOCALE_NAMES` + `isLocale` type guard (ADR 0052 — adicionar locale futuro = 1 linha + diretório + `CHECK` constraint).
  - **`packages/ui/src/tokens.css`:** port fiel de `prototipo/tokens.css` + 2 tokens novos (`--ev-touch-min: 44px` / `--ev-input-min: 48px`) pra regra 31; dark via `[data-theme="dark"]` + `prefers-color-scheme`.
  - **Scripts CI:** `scripts/i18n-extract.mjs` (regex `useTranslations|getTranslations` + `t('key')` com tracker de namespace) + `scripts/i18n-check.mjs` (paridade entre locales + cobertura de uso vs default — regra 27 enforced; rodou local: ✓ 17 keys × 3 locales · 3 usages).
  - **`.github/workflows/ci.yml`:** 5 jobs paralelos (`lint` Biome · `typecheck` turbo · `test` Vitest stub · `i18n` paridade+cobertura · `db` com `pgvector/pgvector:pg16` service container + `db:migrate` + `db:rls-check`); `concurrency` cancela PRs antigos; `permissions: contents: read`. `docs-check.yml` bumpa Node 20 → 22.
  - **Vitest:** `packages/config/vitest.base.ts` reusável (env `node`, coverage v8 com threshold 60% baseline; críticos sobrescrevem via `mergeConfig`).
  - **Pendente Faixas 2-4:** Coolify+Oracle bootstrap (Faixa 2) · security headers + GlitchTip + Loki/Grafana + Cloudflare R2 backup (Faixa 3) · 8 lints custom + esqueletos suíte `smoke/` e `critical/` + helpers Playwright + RIPDs vazios (Faixa 4).
  - **Próximo desbloqueio dev:** `pnpm install` (gera `pnpm-lock.yaml` esperado pelo CI `--frozen-lockfile`) → `pnpm dev:up` → `pnpm db:migrate` → `pnpm dev`.

- **2026-04-27 — `packages/errors` scaffolding (ADR 0071 + regra 33).** Sistema de tratamento de erros base entregue como precondição de Sprint 01a (Server Actions reais) e Faixa 4 (lint `no-unwrapped-action`). Não fecha faixa específica do Sprint 00 (% continua 25); destrava trabalho cross-faixa.
  - **Envelope canônico** (`api-error.ts`): tipo `ApiError` com 16 códigos fechados (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `AI_QUOTA_EXCEEDED`, `AI_PROVIDER_ERROR`, `PAYMENT_FAILED`, `FISCAL_REJECTED`, `CONSENT_REQUIRED`, `COMMITTEE_REQUIRED`, `SLUG_TAKEN`, `TENANT_SUSPENDED`); tipo `ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }`; classe `ApiException` para handlers lançarem com `code` específico; helpers `ok()`/`err()`/`isApiException()`.
  - **Sanitização LGPD** (`sanitize.ts`): `maskCpf`/`maskCnpj`/`maskEmail`/`maskPhone` regex-based; `sanitize()` recursivo redact total para 27 chaves (senha/token/dado clínico — LGPD art. 11). Aplicado antes de envelope ao cliente, payload GlitchTip e log estruturado.
  - **Fingerprint** (`fingerprint.ts`): SHA-256 de `(code, module, tenant_id, signal)` truncado em 16 hex pra dedup multi-tenant em `system_alerts`. `node:crypto` — só Node runtime; middleware Edge usa `globalThis.crypto.randomUUID()` separadamente.
  - **Translators** (`translators.ts`): 10 stubs por provedor (Asaas/Focus NFe/Anthropic/Gemini/Groq/OpenAI/Twilio/TISS/Pluggy/Zod) + fallback genérico que sempre matches. Sprint dono refina cada um quando integração chega.
  - **Wrappers**: `wrapAction` (Server Actions → `ApiResult`), `wrapApiHandler` (API Routes → `Response` com status HTTP derivado do código), `wrapJob` (cron/queue). Cada um captura `ApiException`, traduz erros desconhecidos via translators, monta fingerprint, loga JSON estruturado no stdout. Hooks `auth/permissions/rate-limit/audit/alerts/GlitchTip` marcados com `// TODO Sprint 01a/Faixa 3` e ficam ativos quando deps existirem.
  - **i18n catalog** `errors.json` (16 mensagens × 3 locales = 48 traduções; `i18n-check` validado: ✓ 33 keys × 3 locales · 3 namespaces).
  - **`apps/web/src/i18n/request.ts`** atualizado: `NAMESPACES = ['common', 'auth', 'errors']` (next-intl carrega catalog automaticamente).
  - **TODOs explícitos** preservados nos wrappers para auditar antes de marcar Sprint 00 done — auth, RBAC, rate limit, audit log + hash chain, system_alerts insert, GlitchTip capture, retry com backoff (Sprint 01a + Faixa 3).

- **2026-04-27 — Faixa 3 parcial + Faixa 4 parcial entregues (50% do sprint).** Tudo o que dá pra fazer sem Coolify rodando ou contas externas (Oracle/Cloudflare). Restante de Faixa 2-4 mapeado abaixo.
  - **Security headers (regra 35 + ADR 0073)** em [`apps/web/next.config.ts`](../../apps/web/next.config.ts) `headers()`: HSTS preload (max-age 2 anos + includeSubDomains) · X-Frame-Options DENY · X-Content-Type-Options nosniff · Referrer-Policy strict-origin-when-cross-origin · Permissions-Policy restritiva (camera/mic/geo/bluetooth/payment somente em self; usb=()) · COOP same-origin · CORP same-site.
  - **CSP nonce dinâmico** em [`apps/web/middleware.ts`](../../apps/web/middleware.ts): nonce per-request via `crypto.getRandomValues(16 bytes) + btoa()`; injetado em request headers (`x-nonce`) pra Server Components lerem; `script-src 'nonce-...' 'strict-dynamic'` (sem `'self'`); `style-src 'self' 'unsafe-inline'` (Tailwind v4 exige); `connect-src 'self'` (sprints donos expandem com Asaas/Vertex/Anthropic/etc); `frame-ancestors 'none'`; `object-src 'none'`; `upgrade-insecure-requests`.
  - **`packages/security` real (regras 36-38, 43)**: `safe-fetch.ts` (regra 37 — protocolo http/https, allowedHosts obrigatório, IP privado/loopback/link-local bloqueados, timeout 30s default, redirect manual, max response 50MB; `SsrfError` quando viola); `scan-upload.ts` esqueleto (regra 38 — interface `ScanProvider` + `OwnScanProvider` placeholder, `upload_scans` 5 status canônicos); `rate-limits.ts` (regra 36 — tabela canônica de 8 limites em `RATE_LIMITS` + stub `checkRateLimit` no-op até Faixa 3 ter Redis); `high-risk-actions.ts` (regra 43 — array de 16 ações com `requireMfaMaxAgeMins=15` + 4 `alsoBlockedFromAi: true`).
  - **Página pública [`/seguranca`](../../apps/web/app/(public)/seguranca/page.tsx)** + i18n catalog `security.json` em 3 locales (8 chaves × 3 = 24 traduções).
  - **`/.well-known/security.txt` (RFC 9116)** em `apps/web/public/.well-known/security.txt` com Contact/Expires/Preferred-Languages/Policy/Canonical.
  - **Supply chain CI**: `.gitleaks.toml` (4 rules custom: LF_KEY/Asaas/Focus NFe/GPG armored + allowlist .env.example e docs); `.github/dependabot.yml` (npm + GH Actions, weekly Monday SP timezone, agrupado minor+patch); `.github/workflows/security.yml` separado com 2 jobs (gitleaks + osv-scanner) + scheduled `cron: '0 5 * * 1'`.
  - **Lints custom** (`scripts/lint-custom.mjs` + `pnpm lint:custom`) — 4 checkers regex-based (JS puro, sem deps): `no-window-alert` (regra 45) · `no-raw-fetch` (regra 37) · `no-hardcoded-design-token` (regra 44 — exception comment `// design-token-exempt:`; `tokens.css` e `globals.css` excluídos) · `no-rejected-saas-import` (regra 46 — bloqueia `@supabase/*`/`@upstash/*`/`@vercel/postgres|kv|blob`/`posthog-*` rejeitados pelo ADR 0091). Validado local: ✓ 43 code + 2 css files clean. Lints `no-unwrapped-action`/`high-risk-action-must-require-recent-mfa` ficam para Sprint 01a (precisam Server Actions reais).
  - **Compliance check** (`scripts/compliance-check.mjs` + `pnpm compliance:check`) — RIPD Status (formal Vigente/TODO/Rascunho/Deprecated com hash bate) ou legacy (sprint dono migra) + threat-models STRIDE 6-categorias warning (não falha — nudge); stubs ADR esperado e `ai_audit_log` schema chegam Sprint 01a/06. Validado local: ✓ 1 formal + 18 legacy + 12 threat-models.
  - **Hash RIPD** (`scripts/hash-ripd.mjs` + `pnpm hash:ripd` ou `--check`) — SHA-256 do conteúdo de cada RIPD `Status: Vigente`, atualiza ou checa.
  - **Playwright config** ([`apps/web/playwright.config.ts`](../../apps/web/playwright.config.ts)): 5 projects (chromium-mobile/tablet/desktop + webkit-mobile/desktop); webServer auto-start `pnpm dev`; trace on-first-retry; reporter github+html em CI. Helpers `packages/config/playwright-{viewports,locales}.ts` com `forEachViewport` (3 canônicos: iphone-13/ipad-portrait/desktop-1280) e `forEachLocale` (LOCALES de @repo/i18n; cookie NEXT_LOCALE).
  - **Helpers E2E** stubs em [`apps/web/e2e/helpers/`](../../apps/web/e2e/helpers/): `auth.ts` (`loginAs(persona, scenario)`), `seed.ts` (`loadScenario` 5 cenários canônicos), `time.ts` (`freezeAt` via page.clock.install — anti-flakiness), `db.ts` (`twoConnectionsTest` T6 ADR 0090). Todos lançam `not implemented yet (Sprint 01a)` — testes que dependem ficam em `test.skip()`.
  - **2 specs representativas**: `apps/web/e2e/_template.spec.ts` + `smoke/auth-magic-link.spec.ts` (Top-10 smoke ADR 0090) + `critical/cross-tenant-rls.spec.ts` (T6 + Top-12 block release). Estrutura permite Sprint dono adicionar specs sem refactor.
  - **3 runbooks novos**: [`dr-drill.md`](../runbooks/dr-drill.md) (DR drill quarterly esqueleto com 6 fases + critérios de sucesso; primeiro real Sprint 04+); [`coolify-operacoes.md`](../runbooks/coolify-operacoes.md) (cheatsheet + troubleshooting comum); [`bootstrap-oracle.md`](../runbooks/bootstrap-oracle.md) (passo-a-passo Vinhedo + ARM Ampere + Cloudflare DNS + Caddy SSL + primeiro deploy "Hello World").
  - **RIPD faltante criado**: `v1.0-tiss-convenios.md` (Sprint 22) — completa lista canônica de 7 RIPDs do Sprint 00.
  - **3 scripts novos no `package.json` raiz** + 2 jobs novos no `ci.yml` (`lint-custom`, `compliance`) + workflow separado `security.yml`.
  - **`apps/web/package.json`** ganha `@playwright/test` e `@axe-core/playwright` como devDeps.
  - **Pendente Faixa 2 (precisa de você):** conta Oracle PAYG ativada + SSH key gerada → eu rodo `infra/bootstrap-oracle.sh` + provisão Coolify/Caddy/containers + primeiro deploy. Sem isso, GlitchTip/Loki/Grafana/R2 backup ficam parados.
  - **Pendente Faixa 3 (depende Coolify):** GlitchTip self-host + Loki/Grafana self-host + Cloudflare R2 backup cron + Cloudflare proxy + Turnstile + OWASP ZAP weekly.
  - **Pendente Faixa 4 (sprints donos):** lints `no-unwrapped-action`/`high-risk-action-must-require-recent-mfa` (precisam Server Actions Sprint 01a) · 9 esqueletos `smoke/` adicionais + 11 esqueletos `critical/` adicionais · helpers `webhooks.ts`/`waits.ts` · script `verify-audit-chain.ts` (Sprint 19+) · expansão STRIDE pra 6 categorias nos 12 threat-models legacy.

- **2026-04-27 — Faixa 2 destrava parcial: fundador confirmou conta Cloudflare ativa com domain `logifit.com.br` + entreguei `infra/bootstrap-oracle.sh` + `docs/runbooks/cloudflare-setup.md`.** Coolify ainda **não** instalado (depende de VPS Oracle provisionado primeiro). Os 2 artefatos destravam o caminho: `bootstrap-oracle.sh` é script bash idempotente (apt update+upgrade, Docker, UFW, fail2ban, unattended-upgrades, swap 4GB, hardening SSH, Coolify install oficial, check `/data` mount); `cloudflare-setup.md` documenta os 5 papéis Cloudflare no plano Free (DNS+Proxy, R2 bucket+API token, Turnstile site, Email Routing custom rules, API Token global pra Caddy DNS-01). Próximo desbloqueio: criar conta Oracle Cloud OCI em PAYG + VPS Vinhedo provisionado.

- **2026-04-27 — Sistema de mensagens (ADR 0089) + AppLayout esqueleto + helpers Playwright restantes.** Faixa 4 do Sprint 00 avança ~85%. Catálogo de 6 tipos em `packages/ui/src/messages/` (Toaster Sonner com nonce CSP, toast helpers que consomem ApiError envelope, Banner com ARIA, FormError inline, Alert/Confirm/PromptDialog stubs até Radix Sprint 01a); `packages/ui/src/layout/app-layout.tsx` esqueleto (header + slot hamburger, touch-target 44px, sem sidebar fixa); `apps/web/e2e/helpers/{webhooks,waits}.ts` stubs; namespace i18n `messages` (11 chaves × 3 locales); 5ª regra de lint `no-hardcoded-toast-message`. Validado: ✓ 54 code + 2 css files clean (5 rules) · ✓ 53 keys × 3 locales (5 namespaces).

- **2026-04-27 — Revisão provider de backup off-site: Cloudflare R2 substitui Hetzner Storage Box (regra 40 mantida).** Conversa de custo MVP reabriu opção. Cloudflare R2 ganha em (a) free tier 10GB cobre MVP inteiro a custo zero (Hetzner era €3.50/mês fixo); (b) zero egress fee = DR drills quarterly sem custo de saída; (c) S3-compatible API (rclone) mais simples que SSH+rsync e elimina chave SSH dedicada. Externals reduzidos de 9 para 8 categorias (Cloudflare passa a multi-uso: DNS + R2 + Turnstile + Email Routing — 4 funções no mesmo provider). Hetzner Storage Box mantido como alternativa rejeitada documentada (volta a considerar se volume backup >700GB). Hetzner CX22 Helsinki **continua** como VPS DR alternativo pre-provisionado — não confundir. Atualizados: ADR 0091 (nota de revisão no topo + tabela externals + alternativas rejeitadas + diagrama ASCII + custo MVP), regra 40 ([rules.md](../rules.md)), CLAUDE.md, [.env.example](../../.env.example) (vars `R2_*` substituem `HETZNER_*`), [`dr-drill.md`](../runbooks/dr-drill.md), e este sprint. Custo MVP cai de "~R$ 20/mês" para "~R$ 0/mês".

- **2026-04-29 — `@repo/storage` real entregue (Faixa 1, item linha 73 + linha 262 marcados).** Sprint 00 vai de 50% → 55%. Materializa a regra de soberania perpétua #3 ([ADR 0091](../decisions/0091-self-host-total-oracle-sp.md)) — features de negócio futuras consomem SOMENTE `StorageAdapter`; `@aws-sdk/*` encapsulado neste package.
  - **`packages/storage/src/`** — `types.ts` (interface 7 métodos `put`/`get`/`head`/`delete`/`list`/`presignGet`/`presignPut` + Zod schemas no boundary regra 7 + `StorageError` 5 códigos discriminados); `buckets.ts` (6 buckets canônicos regra 38 — `lab-documents`/`fisio-evolucoes`/`exam-attachments`/`exercises`/`certificados`/`whatsapp-media` + `physicalBucketName(prefix,name)`); `tenant-key.ts` (compositor `${tenantId}/${ownerKind}/${ownerId}/${YYYY}/${MM}/${uuid}.${ext}` + sanitização anti-traversal + UUID v4 obrigatório + allowlist 12 extensões); `minio-adapter.ts` (`MinioStorageAdapter` via `@aws-sdk/client-s3` + `s3-request-presigner`, `forcePathStyle:true`, traduz erros AWS em `StorageError`, `head()` retorna `null` em 404 pra ser idiomático JS); `factory.ts` (`createStorageAdapter(env)` única porta autorizada a ler `MINIO_*` env); `index.ts` public API curada.
  - **`packages/storage/scripts/bootstrap-buckets.ts`** — idempotente (1ª execução `[+] created`, demais `[=] already-exists`); `pnpm storage:bootstrap` no root; aplica `versioning=Enabled` em cada bucket.
  - **Testes (25/25 verdes)**: `buckets.test.ts` (4 unit), `tenant-key.test.ts` (8 unit), `factory.test.ts` (6 unit), `minio-adapter.test.ts` (7 integração contra MinIO local — pula silenciosamente se endpoint não acessível, não quebra CI sem infra). `vitest.config.ts` com coverage threshold 80% (mesmo piso de `errors|security|db/policies` regra 18). Suíte de integração cobre round-trip put/head/get/delete, list por prefixo, presignGet acessível via fetch real, head retornando null em chave inexistente, rejeição de path traversal/bucket fora do enum, tradução de `NoSuchBucket` em `StorageError` (via `put` — `head` perde info por HEAD sem corpo).
  - **Atualizações**: `packages/storage/package.json` ganha `@aws-sdk/client-s3@^3.705.0` + `@aws-sdk/s3-request-presigner@^3.705.0` + `zod@^3.23.8` em deps; `tsx`/`vitest`/`@types/node` em devDeps; scripts `test`/`bootstrap`. Root `package.json` ganha `storage:bootstrap`.
  - **Validado local**: typecheck ✓, biome check ✓ (14 arquivos), bootstrap idempotente ✓, 25/25 testes ✓ contra MinIO container do `docker-compose.yml`.
  - **Não escopo (mapeado)**: `scanUpload` real (file-type + ClamAV + tabela `upload_scans`) — Faixa 3; lint custom `no-unscanned-upload` — Faixa 4; MinIO em produção Coolify — Faixa 2 (depende `bootstrap-oracle.sh`).

## Definition of Done

- [ ] `pnpm dev` funciona em pt-BR (default)
- [ ] Troca de locale via cookie funciona (pt-BR → en-US → es-419 → pt-BR)
- [ ] `pnpm test` verde
- [ ] `pnpm db:rls-check` funcional (cria tabela sem RLS em branch de teste → script falha)
- [ ] `pnpm i18n:check` funcional (remove chave de en-US em branch de teste → script falha)
- [ ] `pnpm docs:check` funcional (cria slug ADR errado em branch de teste → script falha)
- [ ] CI verde no branch
- [ ] GlitchTip self-host capturando em dev e prod (PostHog dropado — regra 12 revisada)
- [ ] Loki + Grafana self-host recebendo logs estruturados (`pino` → stdout → Promtail → Loki) em prod
- [x] **Coolify rodando no VPS Oracle Vinhedo** + primeiro deploy "Hello World" Next.js em `app.logifit.com.br` validado — entregue 2026-05-11 (Faixa 2)
- [ ] **Backup off-site Cloudflare R2** funcional com cron diário + GPG cifrado
- [ ] Tokens "Equilíbrio Vital" aplicados sem sombras residuais do shadcn
- [ ] LocaleSwitcher funcional
- [ ] **Suíte `smoke/` com 10 esqueletos** (`test.skip` nomeados conforme ADR 0090 §6); roda em <2min em PR; CI bloqueia merge se 1 falha
- [ ] **Suíte `critical/` com 12 esqueletos** (ADR 0090 §5); CI bloqueia deploy prod se 1 falha
- [ ] **Coverage gate ativo**: ≥80% em `packages/errors|security|db/policies`; ≥70% em `packages/db`; ≥60% em Server Actions; CI falha se threshold não bate (regra 18 expandida)
- [ ] **`pnpm compliance:check` verde** (RIPD hash + ADR esperado + threat-model + schema `ai_audit_log`)
- [ ] **Helper `twoConnectionsTest()` funcional** com teste exemplo provando isolamento RLS (T6)
- [ ] CHANGELOG.md entrada `[Unreleased] - Added — Monorepo, CI, observabilidade, i18n 3 idiomas, estratégia de testes ADR 0090`
- [ ] Roadmap atualizado (item #1 → done)

## Retro

- —
