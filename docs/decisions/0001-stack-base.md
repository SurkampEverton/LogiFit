# ADR 0001 — Stack base do LogiFit

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

O LogiFit é um ERP SaaS B2B multi-tenant que manipula dados sensíveis de saúde (LGPD art. 11) e atende profissionais regulados (CFM, CRN, CREFITO). Precisa combinar UI moderna (Generative UI na Fase 2), copilot baseado em LLM, realtime (agenda/catraca), e isolamento forte entre tenants. Time: desenvolvimento solo.

## Decision

Stack fixada:

- **Frontend:** Next.js 15 (App Router) + React 19, Tailwind CSS v4, shadcn/ui, Zustand (estado cliente), TanStack Query (estado servidor), React Hook Form + Zod.
- **Backend:** Next.js server-side (Server Components + Server Actions + API Routes). Nenhum serviço backend separado no MVP.
- **Banco/Auth/Realtime/Storage:** Supabase (Postgres gerenciado + Auth + Realtime + Storage + Supavisor + pgvector).
- **ORM:** Drizzle como fonte única do schema; tipos do Supabase CLI desabilitados.
- **IA:** Vercel AI SDK com provider plugável (Claude default; fallback OpenAI/Gemini); cache semântico em `ai_cache` via pgvector; rate limit por tenant via Upstash Redis.
- **Pagamentos:** Asaas (boleto, Pix, cartão recorrente) com webhooks idempotentes.
- **Email:** Resend.
- **Observabilidade:** Sentry + PostHog + Logtail/Axiom desde o dia 1.
- **Qualidade:** Vitest (unit), Playwright (e2e), GitHub Actions (CI), Biome (lint + format).
- **Linguagem:** TypeScript `strict: true`.
- **Infra:** Vercel (frontend/backend Next.js) + Supabase (DB/Auth/Realtime/Storage).

## Consequences

- Deploy único, tipos end-to-end, latência baixa.
- Acopla UI e lógica de negócio — se surgir app nativo ou API pública, parte precisa ser extraída. Mitigado por compartilhamento via `packages/types` e Server Actions bem desenhadas.
- Dependência operacional de Supabase + Vercel. Downtime deles = downtime do produto. Mitigado por observabilidade e possibilidade futura de auto-hospedar Supabase.
- Custos de IA precisam ser controlados desde o início (cache semântico + rate limit + fallback de modelo).
