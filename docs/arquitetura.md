# Plano de Arquitetura: ERP LogiFit

## Context

Projeto **greenfield** em `d:\Projeto\LogiFit` para um ERP SaaS B2B multi-tenant que unifica três verticais — **Academia**, **Fisioterapia** e **Nutrição** — em um só produto. O diferencial é o cruzamento de dados em tempo real entre as áreas (restrição clínica do fisio → alerta no treino; log da academia → sugestão nutricional).

Este é um sistema que manipula **dados sensíveis de saúde** (LGPD art. 11), com profissionais regulados (CFM, CRN, CREFITO). A arquitetura precisa ser robusta desde o dia 1 em **isolamento de tenant, auditoria, criptografia, assinatura de prontuário e continuidade** — não apenas bonita.

---

## Reanálise Crítica (mudanças sobre o rascunho anterior)

O rascunho inicial estava correto em espírito, mas omitia pilares críticos para saúde B2B. Ajustes principais:

1. **Escopo MVP reduzido** — lançar as 3 verticais + IA + Generative UI ao mesmo tempo é receita para atraso. MVP entrega **uma vertical de ponta-a-ponta** + motor cross (CRM/financeiro/agenda).
2. **LGPD / dados de saúde** — prontuário é dado sensível; exige criptografia at-rest por tenant, logs de acesso auditáveis, consentimento granular e assinatura digital (ICP-Brasil) no prontuário do fisio.
3. **Multi-tenancy** — estratégia explícita: **RLS do Postgres** com `tenant_id` em toda tabela, `auth.jwt() -> tenant_id` injetado via custom claim do Supabase. Decidido antes de escrever o 1º schema.
4. **RBAC cross-module** — instrutor da academia **não vê** prontuário do fisio por padrão; acesso exige consentimento do paciente. Modelo de permissão é um dos primeiros schemas.
5. **Drizzle vs Supabase types** — Drizzle é a fonte única do schema; os tipos gerados pelo Supabase são **desabilitados** para evitar duplicação.
6. **Offline-first na catraca** — catraca perde internet; check-in grava localmente e sincroniza. Não é feature do MVP mas precisa ser considerado no design do evento de acesso.
7. **Observabilidade** — Sentry + PostHog + Logtail desde o início, não no final. Custo mínimo, ROI gigante.
8. **CI/CD e testes** — Vitest (unit) + Playwright (e2e) + GitHub Actions configurados no dia 1.
9. **Custos de IA** — cache semântico + rate limit por tenant + fallback de modelo (Haiku → Sonnet) para evitar runaway bill.
10. **Fiscal** — Asaas **não emite NF-e de serviço**; precisa de integração com emissor (Focus NFe / Nota Control) ou módulo próprio — fora do MVP, mas mapeado.
11. **Mobile do aluno** — **não entra no MVP**; PWA bem feito cobre 90% dos casos. App nativo (Expo) vira Fase 2.

---

## 1. Stack Tecnológica

### Design System — *"Equilíbrio Vital — O Espaço Clínico Digital"*
- **Filosofia:** Flat Design extremo (sem sombras, sem 3D). Tipografia e conteúdo guiam o olhar.
- **Tipografia:** Inter (geométrica, sans-serif).
- **Superfícies (Light / Dark):**
  - Fundo geral: `#F4F7F6` / `#1A252F`
  - Cards: `#FFFFFF` + borda 1px Grafite 10% / `#2C3E50`
  - Texto principal: `#2C3E50` / `#ECF0F1`
  - Divisores / inputs: 1px opacidade ou `#34495E` (dark)
- **Ação:**
  - Primário: `#3498DB` / `#5DADE2`
  - Sucesso / saúde: `#2ECC71`
  - Energia / alertas: `#E67E22`
  - **A adicionar:** cor de erro destrutiva (`#E74C3C`) e warning amarelo (`#F39C12`) — faltavam no rascunho.

### Frontend
- **Next.js 15 (App Router) + React 19**
- **Tailwind CSS v4 + shadcn/ui** — sombras padrão removidas via override de tokens
- **Zustand** (estado cliente) + **TanStack Query** (estado servidor)
- **React Hook Form + Zod** — formulários e validação ponta-a-ponta (schemas Zod compartilhados com server actions)

### Backend, Banco e Autenticação
- **Supabase** (Postgres gerenciado):
  - **RLS** com `tenant_id` em toda tabela — decisão arquitetural raiz
  - Auth (OAuth, Magic Link, MFA obrigatório para profissionais de saúde)
  - Realtime (agenda, catraca, notificações)
  - **Supavisor** (connection pool) habilitado desde o dia 1
  - Storage criptografado para mídias clínicas (fotos de postura)
- **Drizzle ORM** — fonte única de verdade do schema; migrations versionadas em `packages/db/migrations/`
- **pgvector** — extensão habilitada para RAG do copilot (busca semântica em prontuário/procedimentos)

### Integrações Externas
- **Asaas** — boleto, Pix, cartão recorrente. Webhooks com idempotência (tabela `webhook_events` com `external_id` único) e dead-letter.
- **Resend** — email transacional.
- **Fiscal (Fase 2):** Focus NFe para NFS-e.

### Inteligência Artificial
- **Vercel AI SDK** com provider plugável (Claude default, OpenAI/Gemini fallback)
- **Cache semântico** em `ai_cache` (pgvector) para reduzir custo em perguntas repetidas
- **Rate limit por tenant** (Upstash Redis) — evita runaway bill
- **Generative UI moved out of MVP** — entra na Fase 2 após validar adoção do copilot simples

### Observabilidade e Qualidade
- **Sentry** (erros front + back)
- **PostHog** (product analytics + feature flags + session replay)
- **Logtail / Axiom** (logs estruturados)
- **Vitest** (unit) + **Playwright** (e2e) + **GitHub Actions** (CI/CD)
- **Biome** (lint + format) — mais rápido que ESLint + Prettier

---

## 2. Arquitetura de Dados (Fundacional)

### Multi-tenancy
- Toda tabela de negócio tem `tenant_id uuid not null` com RLS: `USING (tenant_id = auth.jwt() ->> 'tenant_id'::uuid)`
- `tenant_id` injetado como custom claim no JWT via Supabase Auth Hook
- Migrations automatizadas verificam que nenhuma tabela nova escape da política (teste de CI)

### Hierarquia de entidades (4 níveis)

Ver [multiempresa.md](multiempresa.md) para detalhes, cenários canônicos e árvore de decisão.

```
GROUP (organizacional, sem CNPJ; só agregados)
 └── TENANT (contrato SaaS; RLS raiz)
      └── COMPANY (matriz/filial, com CNPJ; autorização + fiscal)
           └── UNIT (local físico; operacional)
```

- `group` é opcional (tenant pode não pertencer a grupo). Grupo **não** entra em RLS de isolamento — é apenas metadado agregado.
- `tenant` é onde RLS raiz age. Billing acontece aqui.
- `company` tem CNPJ. Constraint: exatamente 1 matriz por tenant; filial é opcional (0..N).
- `unit` é local físico.

### Flags do `tenant`

- `topology`: `owned` | `franchise`
- `financial_mode`: `centralized` | `distributed`
- `cross_company_access`: `true` | `false`

Detalhes em [multiempresa.md](multiempresa.md#flags-do-tenant).

### Tabelas mestras do MVP

- `groups` — opcional; organizacional
- `tenants` — contratos SaaS, com as 3 flags
- `companies` — matriz/filial com CNPJ (`type`, `cnpj` unique global)
- `units` — locais físicos
- `users`, `roles`, `permissions`, `role_permissions`
- `user_roles` — com `scope_type` (`group | tenant | company | unit`) + `scope_id`
- `user_tenants` — N:N entre users e tenants (ex: fisio que atende em 2 clínicas)
- `members` (paciente/aluno — perfil único cross-module, com `tenant_id` + `company_id` + `home_unit_id`)
- `consents` (LGPD — consentimentos granulares por módulo e cross-company)
- `franchise_agreements` (condições de mobilidade cross-company em `topology=franchise`)
- `audit_log` (quem leu/escreveu dado sensível — append-only, particionado por mês)
- `webhook_events` (`external_id` unique para idempotência)

### Cross-module event bus
- Tabela `domain_events` (event-sourcing leve) + Realtime do Supabase para fan-out
- Eventos: `member.injury_registered`, `member.class_checked_in`, `member.diet_updated`
- Consumers inscrevem-se via Supabase Realtime ou Edge Function

---

## 2.5. Comunicação entre camadas

Não há backend separado: Next.js (App Router) **é** o backend. Canais de comunicação:

| Canal | Uso | Quando escolher |
|---|---|---|
| **Server Components** | Leitura inicial da página | Dados que fazem parte do render inicial; sem interação |
| **Server Actions** | Mutações a partir do cliente | Formulários, ações (criar, atualizar, deletar); validar com Zod compartilhado de `packages/types` |
| **Supabase Client (browser)** | Leituras dinâmicas e realtime | Listas que atualizam, dashboards reativos; RLS é a proteção |
| **Supabase Realtime (WS)** | Push server→client | Agenda mudando em tempo real, catraca, notificações |
| **TanStack Query** | Cache cliente | Por cima de Server Actions e Supabase client |
| **API Routes (`app/api/*`)** | Endpoints HTTP | Webhooks externos (Asaas, Resend), streaming de IA (`/api/ai/*`) |

### Árvore de decisão

```
Precisa de dado no render inicial da página?
 └─ Sim → Server Component (Drizzle direto)
 └─ Não → interação cliente?
          ├─ Mutação (create/update/delete) → Server Action
          ├─ Leitura reativa/realtime         → Supabase client + Realtime
          ├─ Webhook vindo de fora            → API Route em /api/webhooks/*
          └─ Streaming de IA                  → API Route em /api/ai/*
```

### Contratos compartilhados

- **Zod schemas** em `packages/types` — validação em Server Action, API Route, webhook. Tipo idêntico no cliente e no servidor.
- **Drizzle schema** em `packages/db` — tipos fluem para client e server.
- **Eventos de domínio** em `packages/types/events.ts` — payload tipado para fan-out Realtime.

### Fluxo de autenticação no boundary

1. Browser envia cookie httpOnly + header Authorization.
2. Server Component / Server Action / API Route valida JWT com `createServerClient` (SSR helper do Supabase).
3. JWT tem `tenant_id` + `scopes[]` como custom claims — RLS usa.
4. Para webhooks externos (sem JWT), autenticação é por **assinatura HMAC** (Asaas) + idempotência via `webhook_events.external_id`.

### Erros e idempotência

- Server Actions retornam `{ ok: true, data } | { ok: false, error: {...} }` padronizado.
- Erros são logados em Sentry com `tenant_id` e `user_id` no contexto.
- Webhooks são **idempotentes** — receber o mesmo `external_id` duas vezes não duplica cobrança/registro. Regra 8.

---

## 3. Escopo por Fases

### MVP (3 meses) — **Academia + Motor Cross**
- Auth, multi-tenancy, RBAC, LGPD consent flow
- CRM unificado (`members` + histórico)
- Agenda universal (com slots de Academia funcionando)
- Financeiro: Asaas (planos, boletos, Pix, recorrência, webhooks)
- Controle de acesso Academia (QR code, catraca via Realtime)
- Copilot simples (chat ancorado em contexto do paciente selecionado)
- Dashboard com tokens "Equilíbrio Vital" + light/dark

### Fase 2 (3–6 meses) — **Fisioterapia**
- Prontuário eletrônico + assinatura ICP-Brasil
- Evolução com mídias (Storage criptografado)
- Cross-alert: lesão → treino
- Generative UI (cards de relatório)

### Fase 3 (6–9 meses) — **Nutrição + App do aluno**
- Antropometria + cardápios
- IA Nutri-Agent cruzando log da academia
- App nativo (Expo) — PWA continua como fallback
- Módulo fiscal (Focus NFe)

---

## 4. Plano de Inicialização Imediato

1. **Monorepo Turborepo + pnpm** em `d:\Projeto\LogiFit`
   - Apps: `web` (Next.js 15)
   - Packages: `db` (Drizzle), `ui` (shadcn custom), `ai` (Vercel AI SDK wrappers), `config` (tsconfig, biome), `types` (Zod schemas compartilhados)
2. **Supabase CLI** + projeto local com Docker; migrations Drizzle aplicadas via `drizzle-kit`
3. **Tokens de design "Equilíbrio Vital"** em `packages/ui/tailwind.config.ts` + primitives shadcn com sombras removidas
4. **Schema inicial:** `tenants`, `users`, `roles`, `members`, `consents`, `audit_log`, `domain_events` — **todas com RLS desde o commit inicial**
5. **CI pipeline:** type-check, biome, vitest, drizzle migrate dry-run, teste que verifica RLS em toda tabela nova
6. **Observabilidade:** Sentry + PostHog integrados no `app/layout.tsx`

---

## Decisões Confirmadas

- **Gateway financeiro:** Asaas (boleto + Pix + cartão recorrente)
- **Infraestrutura:** Vercel (frontend) + Supabase (DB / Auth / Realtime / Storage)

---

## Critical Files (a serem criados)

- `d:\Projeto\LogiFit\apps\web\app\` — rotas Next.js (App Router)
- `d:\Projeto\LogiFit\packages\db\schema\` — Drizzle schemas por domínio
- `d:\Projeto\LogiFit\packages\db\migrations\` — SQL versionado
- `d:\Projeto\LogiFit\packages\db\rls\` — políticas RLS centralizadas
- `d:\Projeto\LogiFit\packages\ui\` — design system
- `d:\Projeto\LogiFit\packages\ai\` — AI SDK wrappers + cache semântico
- `d:\Projeto\LogiFit\packages\types\` — Zod schemas compartilhados
- `d:\Projeto\LogiFit\.github\workflows\ci.yml`
- `d:\Projeto\LogiFit\supabase\config.toml`

---

## Verification Plan

1. `pnpm dev` roda sem erros; dashboard em `localhost:3000`
2. Toggle light/dark aplica tokens "Equilíbrio Vital" (sem sombras residuais do shadcn)
3. Login Magic Link via Supabase funciona; JWT contém `tenant_id` como custom claim
4. Query Drizzle em `members` de um tenant **não retorna** dados de outro tenant (teste Playwright)
5. Webhook Asaas de teste grava em `webhook_events` e é idempotente (replay não duplica)
6. Endpoint `/api/ai/ping` faz streaming e grava no `ai_cache`; segunda chamada idêntica bate cache
7. CI roda verde: type-check, lint, vitest, e2e, drizzle migrate, teste de RLS
8. Sentry captura erro sintético; PostHog registra pageview
