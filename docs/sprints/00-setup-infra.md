# Sprint 00 — Setup de Infra

- **Início:** planejado
- **Fim planejado:** **+4 semanas** (revisado 2026-04-25 — escopo foi expandido pelas 4 auditorias com 8 lints custom + estruturas compliance/runbooks/threat-models + arquivos `dev/portability.md`/`realtime.md` + `high-risk-actions.ts`; absorve melhor em 4 semanas que em 3). Revisão posterior 2026-04-25 — bullets pequenos de extensibilidade i18n (ADR 0052 reforçado): `LOCALE_NAMES`/`FALLBACK_CHAIN` em config, schema TEXT+CHECK (sem enum), `i18n:translate` script, `playwright-locales.ts` helper, runbook `adicionar-novo-locale.md` esqueleto. Cabe na Faixa 1 sem estourar timebox.
- **Status:** planejado
- **Item do roadmap:** #1

## Goal

Monorepo funcional, Supabase local rodando, CI verde, observabilidade ligada, **i18n configurado em 3 idiomas (pt-BR/en-US/es-419)** e **teste CI de RLS ativo**. Zero feature de negócio.

## Estratégia de timebox (4 semanas)

Para evitar estouro do timebox padrão de 3 semanas (regra 9), Sprint 00 organiza-se em **3 faixas executáveis em sequência curta**, cada uma com DoD próprio:

- **Faixa 1 (semana 1):** infra core — monorepo, Supabase local, Drizzle, Biome, Vitest, Playwright, CI verde básica, i18n config, Sentry/PostHog, design tokens
- **Faixa 2 (semanas 2-3):** segurança em profundidade — Cloudflare proxy + Turnstile, headers + CSP nonce, `safeFetch`, `scanUpload`, backup R2, OWASP ZAP, secret scanning, Dependabot, OSV-scanner, SBOM, `/.well-known/security.txt`, `packages/security/high-risk-actions.ts`
- **Faixa 3 (semana 4):** lints custom + docs operacionais — `no-unwrapped-action`, `no-raw-fetch`, `no-unscanned-upload`, `no-hardcoded-design-token`, `no-direct-supabase-query`, `no-supabase-functions`, `high-risk-action-must-require-recent-mfa`, `cross-tenant-read-must-log` (este vira ativo só no Sprint 02), `no-window-alert` + `no-hardcoded-toast-message` (regra 45 / ADR 0089), templates RIPD vazios para sprints clínicos, `docs/dev/portability.md`, `docs/dev/realtime.md`

**Se Faixa 3 estourar:** mover lints `cross-tenant-read-must-log` para Sprint 02 (onde primeiro consumidor real existe) e `no-hardcoded-design-token` para Sprint 00b (menu lateral, primeiro consumidor real de design system). Sprint 00 mantém DoD se entregar Faixas 1+2 + esqueleto da Faixa 3.

## Critério de aceite

- `pnpm dev` abre Next.js em `localhost:3000`
- `pnpm test` roda Vitest verde
- `pnpm db:migrate` aplica migrations Drizzle no Supabase local
- `pnpm db:rls-check` falha se encontrar tabela sem RLS habilitada (regra 2 enforced)
- `pnpm i18n:check` falha se encontrar chave faltando em qualquer locale (regra 27 enforced)
- CI (GitHub Actions) passa: type-check, Biome, Vitest, drizzle migrate dry-run, `db:rls-check`, `i18n:check`, `docs:check`
- Sentry captura erro sintético em dev
- PostHog registra pageview
- Tokens "Equilíbrio Vital" aplicados em componente de teste (light/dark sem sombras residuais)
- **Idiomas: pt-BR default; en-US e es-419 funcionais;** troca via cookie `NEXT_LOCALE` + inferência por `Accept-Language`
- **Suíte `smoke/` Playwright** com 10 esqueletos (`test.skip` com nome do caso conforme ADR 0090 §6) roda em <2min em todo PR; suíte `critical/` com 12 esqueletos (ADR 0090 §5); ambas usam matriz Playwright + helpers `auth.ts`/`seed.ts`/`time.ts`
- **Coverage gate** ativo: ≥80% em `packages/errors|security|db/policies` (camadas de defesa, regra 18), ≥70% em `packages/db`, ≥60% em Server Actions; CI falha se threshold não bate
- **Script `pnpm compliance:check`** valida: RIPD em `Status: Vigente` com hash batendo, ADR esperado de cada sprint publicado, threat-model presente para feature crítica, schema `ai_audit_log` com colunas obrigatórias (regra 28)

## Dependências

- Nenhuma (é o primeiro sprint)

## Decisões tomadas

- [ADR 0001 — Stack base](../decisions/0001-stack-base.md)
- [ADR 0004 — Drizzle como fonte única do schema](../decisions/0004-drizzle-fonte-unica-schema.md)
- [ADR 0052 — i18n 3 idiomas](../decisions/0052-i18n-tres-idiomas-pt-en-es.md)
- [ADR 0071 — Sistema de tratamento de erros + alertas em tempo real](../decisions/0071-sistema-tratamento-erros-alertas-tempo-real.md) — **entrega infra base aqui** (envelope + wrappers + middleware + translators stubs + sanitização LGPD + regra 33 + lint)
- [ADR 0073 — Postura de segurança (defesa em profundidade)](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) — **entrega camadas 1, 3 e 6 aqui** (security headers + CSP nonce + rate limit global + safeFetch + scanUpload + secret scanning + Dependabot/OSV-scanner + SBOM + `/.well-known/security.txt` + página `/seguranca` + regras 35-38 ativas em CI)
- [ADR 0078 — Hospedagem em duas fases](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md) — **8 regras de portabilidade ativas desde aqui** (storage adapter pattern, RLS em SQL puro, JWT cookie próprio, sem Edge Functions, lint `no-supabase-functions` + `no-direct-supabase-query`)
- [ADR 0089 — Sistema de mensagens padronizadas](../decisions/0089-sistema-mensagens-padronizadas.md) — **entrega catálogo de 6 tipos aqui** (Toast/Banner/AlertDialog/ConfirmDialog/PromptDialog/FormError + Sonner + helpers `toast`/`confirm`/`prompt` + `<Toaster nonce>` + lints `no-window-alert` + `no-hardcoded-toast-message` + regra 45 ativa em CI)
- [ADR 0090 — Estratégia de testes (taxonomia T1-T21 + 3 níveis + suítes E2E)](../decisions/0090-estrategia-de-testes.md) — **entrega infra base aqui**: estrutura de 10 suítes E2E (`smoke`/`critical`/`regression`/`i18n`/`responsiveness`/`a11y`/`visual`/`perf`/`security`/`external`), helpers (`auth`/`seed`/`time`/`webhooks`/`db`), 10 esqueletos `smoke/` + 12 esqueletos `critical/` (`test.skip` com nome do caso), Vitest coverage gate por package, ferramentas instaladas (MSW + fast-check + axe-playwright + k6 + tsd), script `compliance:check`, helper `twoConnectionsTest()` (T6 RLS comportamental). Lost Pixel/Stryker/jazzer.js adiados para sprint dono (sem consumidor real ainda)

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
- [ ] **Helper `packages/config/playwright-locales.ts`** (ADR 0052 — extensibilidade i18n) — exporta `forEachLocale(test, name, fn)` que itera `LOCALES` de `packages/i18n/config.ts`; smoke obrigatório `apps/web/e2e/i18n-smoke.spec.ts` carrega `/`, `/login`, `/signup` em cada locale e assertiva: (a) sem chaves nuas tipo `common.foo.bar` na DOM, (b) sem overflow horizontal, (c) `<LocaleSwitcher>` lista todos `LOCALE_NAMES` corretos. Adicionar locale futuro herda smoke automaticamente (zero edição de teste)
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
- [ ] **Templates Resend nascem multi-locale** — Sprint 01a (primeiro template de auth/recovery) e demais sprints com email seguem padrão `apps/web/src/messages/{locale}/email-{template}.json`; render no locale do destinatário via `persons.preferred_locale` com fallback `tenants.default_locale` (ADR 0052 §Escopo de impacto)
- [ ] Runbook `docs/runbooks/adicionar-novo-locale.md` (esqueleto inicial em Sprint 00 — conteúdo amadurece conforme implementação avança)

**RLS e qualidade:**

- [ ] Script `packages/db/tests/rls-check.ts` — lê schema Drizzle, verifica cada tabela tem `tenant_id` + policy RLS; falha se faltar (enforcement da regra 1+2)
- [ ] CI GitHub Actions (`.github/workflows/ci.yml`) roda: `typecheck`, `biome:check`, `vitest`, `drizzle:migrate:dry`, `db:rls-check`, `i18n:check`
- [ ] `biome.json` com regra custom de "no-hardcoded-strings" (ou fallback: comentário convencional) para evitar violação da regra 27
- [ ] Sentry + PostHog integrados em `app/layout.tsx`
- [ ] Logtail/Axiom para logs estruturados (era stretch, agora core)
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
- [ ] Dashboard PostHog com eventos `ai.call`, `ai.cache_hit`, `ai.error`

**Segurança em profundidade (ADR 0073 + regras 35-38):**

- [ ] **Security headers (regra 35)** em `apps/web/next.config.ts` `headers()`:
  - `Content-Security-Policy` com nonce dinâmico (middleware injeta) — script-src 'self' + nonce; style-src 'self' 'unsafe-inline' (tailwind); img-src 'self' data: https://*.supabase.co; connect-src com allowlist explícita de Supabase + providers IA + PostHog + Sentry; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` restritiva (camera/mic/geo/bluetooth/payment somente em `self`)
  - `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Resource-Policy: same-site`
- [ ] Middleware injeta CSP nonce dinâmico (Next.js 15 server component) + propaga em `next/script`
- [ ] Submeter `logifit.com.br` ao [HSTS Preload List](https://hstspreload.org) após smoke test
- [ ] Teste E2E `apps/web/e2e/security-headers.spec.ts` valida cada header presente em `/`, `/login`, `/app/dashboard` (3 viewports — Playwright); falha CI se ausente
- [ ] **Rate limit global (regra 36)** em `packages/errors/wrap-action.ts` (estende ADR 0071) + `wrap-api-handler.ts` — Upstash Redis com sliding window; chave `(tenant_id, user_id, ip, endpoint)`; tabela canônica de limites em `packages/security/rate-limits.ts` (login 10/15min IP + 5/15min email · read 100/min · write 30/min · IA 20/min · search 30/min · webhook 60/min IP · signup 3/h IP); excedido retorna `RATE_LIMITED` com `retry_after_ms`
- [ ] Conta Upstash criada + `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` em Vercel encrypted env (free tier 10k commands/dia)
- [ ] **`packages/security/safe-fetch.ts` (regra 37)** — wrapper único para fetch externo: protocolo http/https, DNS resolve + bloqueio IP privado/loopback/link-local, `allowedHosts: string[]` obrigatório do caller, timeout 30s, maxResponseBytes 50MB, `redirect: 'manual'`; lança `SsrfError` em violação
- [ ] **Lint custom `no-raw-fetch`** em Biome — bloqueia commit se `fetch(url)` aparece fora de `safeFetch()` ou de testes (`*.test.ts`); exceção via `// safe-fetch-exempt: <motivo>`
- [ ] **Lint custom `no-hardcoded-design-token`** (regra 44) em Biome — bloqueia commit em `apps/web/**/*.{ts,tsx,css}` (exceto `tokens.css` próprio) com hex literal (`#[0-9A-Fa-f]{3,6,8}`), `font-family:` literal (exceto `Inter, sans-serif`), `padding:`/`margin:`/`gap:` numérico literal (exceto `0`), `border-radius:` literal, `font-size:` literal, `line-height:` literal, `font-weight:` numérico (exceto via `var(--ev-*)` ou alias shadcn `var(--primary)`/`var(--background)`/`var(--radius)`); exceção via `// design-token-exempt: <motivo>`
- [ ] **Lint custom `high-risk-action-must-require-recent-mfa`** (regra 43) em Biome — bloqueia commit se Server Action listada em `packages/security/high-risk-actions.ts` (ver abaixo) não chama `requireRecentMfa()` antes da lógica
- [ ] **`packages/security/high-risk-actions.ts`** (regra 43) — array tipado `[{action: string, requireMfaMaxAgeMins: number, category: 'fiscal'|'rbac'|'financeiro'|'compliance'|'super-admin', alsoBlockedFromAi?: boolean}]` com lista canônica MVP: `cancelTissGuide`, `cancelNfe`, `voidPaidInvoice`, `updateInvoiceAmount`, `updateUserRole`, `createCustomRole`, `grantUserPermission`, `updateAsaasKey`, `configureBillingByok`, `runOpenFinancePayment` *(alsoBlockedFromAi)*, `anonymizeMember` *(alsoBlockedFromAi)*, `deleteClinicalData` *(alsoBlockedFromAi)*, `exportFullProntuario` *(alsoBlockedFromAi)*, `terminateTenant`, `openPamSession`, `restoreBackup`. Default `requireMfaMaxAgeMins=15`. Cada feature dependente de TISS/RBAC/financeiro/super-admin importa lista pra encontrar suas próprias ações.

  **Nota sobre colisão regra 41 ↔ 43:** ações marcadas `alsoBlockedFromAi=true` têm dupla proteção — (a) se invocadas por humano via UI: exigem MFA recente <15min (gate `requireRecentMfa()` regra 43); (b) se tentadas via Assistente IA: bloqueadas pelo lint `ai-block-respected` (regra 41 — handler tem comentário `// ai-blocked: <motivo>`). **As duas proteções são independentes e cumulativas** — IA nunca chega ao handler (regra 41); se chegasse via bypass, o gate MFA pegaria (regra 43). Sem gap.
- [ ] Teste E2E: tentar executar `cancelTissGuide` sem `mfa_at` recente → 403 + `MFA_RECENT_REQUIRED` no envelope; após `requireRecentMfa()` (re-TOTP), executa OK
- [ ] **`packages/security/scan-upload.ts` (regra 38) — implementação MVP zero-custo:** provider abstrato (`ScanProvider` interface) com adapter `OwnScanProvider` ativo por padrão; valida MIME real (`file-type` npm, free), magic bytes, extension allowlist por bucket, size cap, embed detection (PDF: regex em raw bloqueia `/JavaScript`/`/JS`/`/OpenAction`/`/Launch`/`/EmbeddedFile`; Office: regex bloqueia `vbaProject.bin`/`macros/` em zipped; imagens: bloqueia EXIF anômalo + polyglot via magic bytes mismatch), hash SHA256 com lookup opcional em seed `known_malicious_hashes`. Resultado em `upload_scans (id, tenant_id, storage_path, status enum 'pending'|'clean'|'suspicious'|'rejected'|'error', detection_reason text nullable, scanned_at, scan_provider text default 'own')`. **Fase 2:** plugar `ClamAvAdapter` ou `CloudmersiveAdapter` via env var `SCAN_PROVIDER` sem refactor. Lint custom `no-unscanned-upload` em rotas de upload.
- [ ] **Cloudflare proxy free tier** na frente de `logifit.com.br`: DNS aponta para Cloudflare, Cloudflare proxy → Vercel; SSL Full (strict) + Always HTTPS + bot fight mode + rate limiting (10k requests free/mês); 5 regras WAF customizadas (free)
- [ ] **Backup off-site grátis (regra 40)** — script `scripts/backup-offsite.ts` faz `pg_dump` cifrado com GPG (chave LogiFit em Vercel encrypted env `BACKUP_GPG_KEY`) + envia para **Cloudflare R2** (free 10GB) OU **Backblaze B2** (free 10GB) via S3-compatible API; Vercel Cron weekly (`/api/jobs/backup-offsite-weekly`); rotação 12 meses; chave GPG **nunca** no mesmo storage do dump
- [ ] Script `scripts/restore-test.ts` documenta procedimento de restauração em Supabase free instance temporária; `runbooks/restore-test.md` com passo-a-passo
- [ ] **OWASP ZAP automated scan weekly (ADR 0073)** — GitHub Action `zaproxy/action-baseline@v0.10.0` rodando contra ambiente staging Vercel; resultado SARIF anexado ao Security tab; alerts ≥medium criam issue automaticamente; agendado via cron `0 2 * * 1` (segunda 02:00 UTC)
- [ ] **`scripts/owasp-check.ts`** em CI antes de release valida cada item OWASP Top 10 enforced (lista em ADR 0073)
- [ ] Schema Drizzle `upload_scans` em `packages/db/schema/security.ts` + RLS por tenant_id
- [ ] **Secret scanning** — Gitleaks pre-commit hook (`.husky/pre-commit`) + GitHub Actions step (`gitleaks/gitleaks-action`) com config customizada (`.gitleaks.toml`) para padrões LogiFit (`LF_KEY_*`, padrão Supabase service role, padrão Asaas API)
- [ ] **Dependabot** habilitado em `.github/dependabot.yml` — npm + GitHub Actions ecosystems, semanal, agrupamento por minor/patch
- [ ] **OSV-scanner** em CI (`google/osv-scanner-action`) — bloqueia merge se vulnerabilidade `severity >= high` em deps de produção; cria issue em `moderate`
- [ ] **SBOM** — script `pnpm sbom:generate` produz `sboms/v{version}.json` em CycloneDX format; commit em release tag
- [ ] **Lockfile audit** — `pnpm audit --audit-level=high` em CI; build com `--frozen-lockfile`
- [ ] **CI permissions hardening** — `.github/workflows/*.yml` com `permissions: read-all` por default; escrita declarada explicitamente por job; ações de terceiros pinadas por SHA (`uses: actions/checkout@a1b2c3d...`)
- [ ] **`/.well-known/security.txt`** em `apps/web/public/.well-known/security.txt` (RFC 9116) com `Contact: mailto:security@logifit.com.br`, `Expires`, `Encryption`, `Preferred-Languages: pt-BR, en`, `Policy`, `Canonical`
- [ ] **Página pública `/seguranca`** em `apps/web/app/(public)/seguranca/page.tsx` — postura resumida (link para ADR 0073 simplificado), política de divulgação responsável (90d coordinated), hall da fama (vazio inicialmente), email `security@logifit.com.br`
- [ ] DNS `security@logifit.com.br` configurado (Cloudflare Email Routing → fundador inicialmente)
- [ ] Conta Cloudflare Turnstile (free) criada + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET` em Vercel env (Sprint 01a usa)

**Portabilidade pra migração de hospedagem (ADR 0078 — 8 regras):**

- [ ] **`packages/storage/`** com interface `StorageAdapter` + `SupabaseStorageAdapter` default; env var `STORAGE_PROVIDER=supabase` (Sprint 19b pluga `R2StorageAdapter` sem refactor de quem usa)
- [ ] **RLS policies em SQL puro** em `packages/db/policies/*.sql` versionadas com Drizzle migrations — proibido criar policy via Supabase Studio (lint manual no PR review)
- [ ] **Connection string via `DATABASE_URL` env** + Drizzle direto; **proibido `supabase.from(...).select()` pra queries** — lint custom Biome `no-direct-supabase-query` bloqueia commit
- [ ] **PROIBIDO Supabase Edge Functions** — toda lógica server-side via Server Actions ou API Routes Next.js; lint custom `no-supabase-functions` bloqueia commit (`@supabase/functions-js` import)
- [ ] **PgBouncer-friendly** — Drizzle config sem prepared statements long-lived; `transaction` mode pooler assumido (preparar pra Oracle)
- [ ] Auth via JWT custom + cookie httpOnly próprio (Sprint 01a entrega — não usar `@supabase/auth-helpers-nextjs`)
- [ ] Realtime: padrão `LISTEN/NOTIFY` documentado em `docs/dev/realtime.md`; Supabase Realtime usado APENAS quando justificável (broadcast pra ≥5 clients simultâneos)
- [ ] Criar `docs/dev/portability.md` com as 8 regras de portabilidade (ADR 0078) + checklist "antes de adotar feature Supabase, isso quebra Sprint 19b?" + tabela de equivalências (Supabase Auth → BetterAuth, Storage → R2, Realtime → LISTEN/NOTIFY, etc)
- [ ] Criar `docs/dev/realtime.md` documentando padrão `LISTEN/NOTIFY` LogiFit (channels, payload JSON, idempotência) + quando usar Supabase Realtime (broadcast ≥5 clients) vs LISTEN/NOTIFY (server-side eventos pontuais)

**Compliance — esqueletos pra sprints clínicos consumirem:**

- [ ] Criar **arquivos vazios de RIPD** (apenas frontmatter + TODO) em `docs/compliance/ripd/`, com proprietário e deadline declarados (nomes canônicos — alinhados com auditorias 11/12/14):
  - `v1.0-prontuario-fisio.md` — proprietário: dev Sprint 20 + DPO; deadline: feature flag `fisio_prontuario_v1` ON
  - `v1.0-tiss-convenios.md` — proprietário: dev Sprint 22 + DPO; deadline: `convenios_v1` ON (a criar quando Sprint 22 entrar em doing)
  - `v1.0-exames-laboratoriais.md` — proprietário: dev Sprint 30 + Sprint 33 + DPO; deadline: `nutri_suplementos_exames_v1` ON OU `exames_ia_v1` ON (RIPD compartilhado entre nutri exames e pipeline IA)
  - `v1.0-nutri-diario.md` — proprietário: dev Sprint 31 + DPO; deadline: `diario_v1` ON
  - `v1.0-teleconsulta.md` — proprietário: dev Sprint 31 + DPO; deadline: `teleconsulta_v1` ON
  - `v1.0-device-hub.md` — proprietário: dev Sprint 32 + DPO; deadline: `device_hub_v1` ON
  - `v1.0-reconhecimento-facial.md` — proprietário: dev Sprint 08 + DPO; deadline: `acesso_facial_v1` ON

  Cada arquivo já contém `Status: TODO`, link para `_template.md`, sprint dependente e deadline em prosa. CI bloqueia merge da sprint correspondente se RIPD ainda está em `Status: TODO`.

- [ ] Criar `scripts/hash-ripd.ts` que computa SHA-256 do conteúdo de cada RIPD em `docs/compliance/ripd/v*.md` e atualiza o campo `Hash SHA-256` no frontmatter; rodado em CI antes de merge (regra 29). Arquivo só vira `Status: Vigente` se hash bate com último commit que tocou o conteúdo.

- [ ] **Runbook esqueleto `docs/runbooks/adicionar-novo-locale.md`** (ADR 0052 — extensibilidade) — passo-a-passo canônico de 10 passos para adicionar um locale futuro (de-DE, fr-FR, etc): atualizar `LOCALES`/`LOCALE_NAMES`, criar diretório `messages/{locale}/`, rodar `pnpm i18n:translate --target {locale}`, revisão humana, INSERT em `translations` para catálogos clínicos via seed, atualizar `CHECK` constraint, `pnpm i18n:check`, smoke E2E na matrix de locales, deploy. Conteúdo amadurece conforme catálogos clínicos e templates email/PDF aterrissarem nos sprints respectivos.

- [ ] **Wire `pnpm docs:check`** no `package.json` raiz apontando para `node scripts/docs-check.mjs` (script já existe na raiz desde a 15ª auditoria). Workflow CI `.github/workflows/docs-check.yml` já roda automaticamente em PRs/push tocando `docs/`; após Sprint 00, dev local roda via pnpm. Validações: número H1 ADR ≡ filename, links MD relativos resolvem, "ADR NNNN (esperado)" não colide entre sprints nem com ADR publicado.

**README e docs:**

- [ ] README atualizado com `pnpm dev`, `pnpm test`, `pnpm db:migrate`, `pnpm db:rls-check`, `pnpm i18n:check`, `pnpm docs:check`

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
- [ ] `pnpm docs:check` funcional (cria slug ADR errado em branch de teste → script falha)
- [ ] CI verde no branch
- [ ] Sentry + PostHog capturando em dev
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
