# ADR 0001 — Stack base do LogiFit

- **Status:** Accepted (atualizado 2026-04-25 com addendum apontando ADR 0078 — hospedagem em duas fases)
- **Date:** 2026-04-22

## Context

O LogiFit é um ERP SaaS B2B multi-tenant que manipula dados sensíveis de saúde (LGPD art. 11) e atende profissionais regulados (CFM, CRN, CREFITO). Precisa combinar UI moderna (Generative UI na Fase 2), copilot baseado em LLM, realtime (agenda/catraca), e isolamento forte entre tenants. Time: desenvolvimento solo.

## Decision

Stack fixada:

- **Frontend:** Next.js 15 (App Router) + React 19, Tailwind CSS v4, shadcn/ui, Zustand (estado cliente), TanStack Query (estado servidor), React Hook Form + Zod.
- **Backend:** Next.js server-side (Server Components + Server Actions + API Routes). Nenhum serviço backend separado no MVP.
- **Banco/Auth/Realtime/Storage:** Supabase (Postgres gerenciado + Auth + Realtime + Storage + Supavisor + pgvector).
- **ORM:** Drizzle como fonte única do schema; tipos do Supabase CLI desabilitados.
- **IA:** Vercel AI SDK com provider plugável + cache semântico em `ai_cache` via pgvector + rate limit por tenant via Upstash Redis. **Decisão de provider/modelo default e routing por task vive no [ADR 0064](0064-ia-arquitetura-gemini-default-byok-rag.md)** (Gemini 2.5 Flash default LogiFit + Groq Whisper STT + BYOK opcional).
- **Pagamentos:** Asaas (boleto, Pix, cartão recorrente) com webhooks idempotentes.
- **Email:** Resend.
- **Observabilidade:** Sentry + PostHog + Logtail/Axiom desde o dia 1.
- **Qualidade:** Vitest (unit), Playwright (e2e), GitHub Actions (CI), Biome (lint + format).
- **Linguagem:** TypeScript `strict: true`.
- **Infra:** **Fase 1 (MVP, Sprint 00 → 19):** Vercel (frontend/backend Next.js) + Supabase Pro (DB/Auth/Realtime/Storage). **Fase 2 (Sprint 19b+):** migra pra Vercel + Postgres no Oracle Cloud OCI free tier + BetterAuth/Lucia + Cloudflare R2 + LISTEN/NOTIFY. Estratégia em 2 fases formalizada no [ADR 0078](0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md) (2026-04-25).

## Consequences

- Deploy único, tipos end-to-end, latência baixa.
- Acopla UI e lógica de negócio — se surgir app nativo ou API pública, parte precisa ser extraída. Mitigado por compartilhamento via `packages/types` e Server Actions bem desenhadas.
- Dependência operacional de Supabase + Vercel **durante MVP**. Downtime deles = downtime do produto. Mitigado por observabilidade + plano de migração já formalizado (ADR 0078) com 8 regras de portabilidade ativas desde o Sprint 00 (storage adapter, RLS SQL puro, JWT cookie próprio, sem Edge Functions, etc).
- Custos de IA precisam ser controlados desde o início (cache semântico + rate limit + fallback de modelo).
- **Lock-in Supabase mitigado por design**: regras de portabilidade da [ADR 0078](0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md) garantem que a migração de Fase 2 é finita (~60h, sem refactor de código de feature).

## Addendum 2026-04-25 (b) — IA superseded por ADR 0064

A linha original "IA: Vercel AI SDK com provider plugável (Claude default; fallback OpenAI/Gemini)" foi **substituída** pelo [ADR 0064](0064-ia-arquitetura-gemini-default-byok-rag.md), que define:

- **Default LogiFit:** Gemini 2.5 Flash (Vertex AI SP) — não Claude
- **STT default:** Groq Whisper
- **BYOK opcional:** Claude/GPT/Maritaca/Anthropic
- **Routing por task** via `resolveModelForTask(task, featureKey?, tenantCtx)` (regra 32 + ADR 0064)

A linha foi atualizada nesse ADR para apontar para 0064 como fonte de verdade.

## Addendum 2026-04-25 — Estratégia em duas fases (ADR 0078)

A linha "Banco/Auth/Realtime/Storage: Supabase" foi qualificada como **decisão de Fase 1 (MVP)**. Pós-MVP estável (Sprint 19b), migra pra stack self-hosted no Oracle Cloud free tier — fundamentado em:

- **Carga PG aumentada pelo ADR 0077** (passaporte cross-tenant): cross-tenant queries em runtime, view materializada, audit log particionado mensal, função `has_cross_tenant_access` hot — Supabase Pro shared CPU 1GB aperta em ~50 tenants
- **Custo Supabase escala mal**: upgrade pra dedicated 2GB+ é $95-185/mês; Small instance $410/mês
- **Oracle Cloud OCI free tier vitalício**: 24GB ARM Ampere + 4 OCPU + 200GB block storage grátis para sempre
- **Usuário tem expertise DevOps real** (projeto Deep Control com PG self-hosted em OCI)

Detalhes completos no [ADR 0078](0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md).
