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
- [ADR 0073 — Postura de segurança (defesa em profundidade)](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) — **entrega camadas 1, 3 e 6 aqui** (security headers + CSP nonce + rate limit global + safeFetch + scanUpload + secret scanning + Dependabot/OSV-scanner + SBOM + `/.well-known/security.txt` + página `/seguranca` + regras 35-38 ativas em CI)

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
