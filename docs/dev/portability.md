# Portabilidade Supabase → Oracle Cloud (preparação Sprint 19b)

> Documento de **referência prática** para todo dev que toca infra de banco/auth/storage/realtime durante o MVP. Tira dúvida de "isso quebra Sprint 19b?" sem precisar reler ADR completo.
> Fonte de verdade: [ADR 0078 — Hospedagem em duas fases](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md). Aqui é o cookbook executável.

## As 8 regras de portabilidade (todas valem desde Sprint 00)

| # | Regra | Por quê | Onde aplicar |
|---|---|---|---|
| 1 | RLS policies em SQL puro em `packages/db/policies/*.sql` | Supabase Studio gera RLS ad-hoc não-versionada — quebra ao migrar | Toda migration que cria tabela com `tenant_id` |
| 2 | Auth via JWT + cookie httpOnly próprio (NUNCA `@supabase/auth-helpers-nextjs`) | Helpers acoplam SDK Supabase ao Next.js — Sprint 19b precisa rip&replace | `apps/web/middleware.ts` + `packages/auth/` |
| 3 | Storage com adapter pattern em `packages/storage/` (interface + `SupabaseStorageAdapter` default) | Permite plugar `R2StorageAdapter` no Sprint 19b sem refactor de quem usa | Todo upload/download de arquivo |
| 4 | Realtime usa PG `LISTEN/NOTIFY` quando possível; Supabase Realtime apenas para broadcast ≥5 clients | LISTEN/NOTIFY é nativo Postgres — funciona em Oracle Cloud sem mudança | Ver `realtime.md` |
| 5 | **PROIBIDO** Supabase Edge Functions — toda lógica server-side via Server Actions/API Routes | Edge Functions são Deno isolado — Sprint 19b não tem equivalente; reescrita = fricção alta | Lint `no-supabase-functions` em CI |
| 6 | PgBouncer-friendly desde dia 1 (sem prepared statements long-lived) | Oracle Cloud usa PgBouncer transaction mode — prepared statements quebram | Drizzle config |
| 7 | Connection string via `DATABASE_URL` env; Drizzle direto, NUNCA `supabase.from(...).select()` para queries | Cliente Supabase quebra fora do Supabase — Drizzle funciona em qualquer Postgres | Lint `no-direct-supabase-query` em CI |
| 8 | Drizzle como única fonte de schema (regra 3 já existente) | Tipos do Supabase CLI desligados — schema vive só em `packages/db/schema/` | `drizzle.config.ts` |

## Tabela de equivalências (Fase 1 → Fase 2)

| Componente | Fase 1 (MVP) | Fase 2 (pós-Sprint 19b) | Adapter LogiFit |
|---|---|---|---|
| **Postgres** | Supabase Pro (gerenciado) | Oracle Cloud OCI ARM Ampere 24GB self-hosted | Drizzle direto (transparente) |
| **Connection pool** | Supavisor (Supabase) | PgBouncer (próprio) | Mesma `DATABASE_URL` env |
| **Auth** | Supabase Auth (magic link + OAuth + TOTP) | BetterAuth (ou Lucia) — feature parity com TOTP/recovery codes | `packages/auth/provider.ts` interface única |
| **Storage** | Supabase Storage (S3-compat) | Cloudflare R2 (S3-compat) | `packages/storage/StorageAdapter` interface; `SupabaseStorageAdapter` default → `R2StorageAdapter` |
| **Realtime** | Supabase Realtime (broadcast cross-client) | PG LISTEN/NOTIFY + ws.js server-side | Adapter em `packages/realtime/` |
| **Backup** | Supabase backup nativo + R2 GPG dump | pgBackRest + R2 (mantém R2 — ADR 0078) | `scripts/backup-offsite.ts` (sem mudança) |
| **pgvector** | Supabase Postgres extension habilitada | Oracle Cloud Postgres extension habilitada | Drizzle queries iguais |

## Checklist "antes de adotar feature Supabase nova, isso quebra Sprint 19b?"

Use este checklist sempre que estiver tentado a usar uma feature **específica** do Supabase (não-padrão Postgres):

- [ ] **A feature é portável?** Existe equivalente em Postgres puro ou em outro provider?
- [ ] **Se não:** existe adapter pattern documentado em `packages/`? Posso plugar mock em testes?
- [ ] **Se não:** quanto código de feature seria reescrito no Sprint 19b? (estimar em horas)
- [ ] **Se >4h:** descartar feature; usar alternativa portável
- [ ] **Se ≤4h:** documentar em ADR específico explicando por que vale a pena + estimativa do esforço de migração

**Features Supabase explicitamente proibidas** (lint bloqueia):

- Supabase Edge Functions (lint `no-supabase-functions`)
- `supabase.from().select()` queries (lint `no-direct-supabase-query`)
- `@supabase/auth-helpers-nextjs` (lock-in fatal)

**Features Supabase aceitáveis** (com adapter pattern):

- Supabase Storage (via `SupabaseStorageAdapter`)
- Supabase Auth para magic link/OAuth/TOTP (via `signInWithOtp`/`signInWithOAuth`/`verifyOtp` apenas — sessão extraída para cookie próprio)
- Supabase Realtime (apenas para broadcast ≥5 clients; caso contrário usar LISTEN/NOTIFY)

## O que **muda** no Sprint 19b vs o que **não muda**

**Muda (≈60h trabalho concentrado):**
- `DATABASE_URL` aponta para Oracle Cloud
- `packages/auth/` swap de provider (Supabase → BetterAuth)
- `packages/storage/StorageAdapter` instancia `R2StorageAdapter`
- `packages/realtime/` swap (Supabase Realtime → ws.js + LISTEN/NOTIFY)
- DNS (sem impacto direto no app)

**NÃO muda (zero refactor):**
- Schema Drizzle (já portátil)
- RLS policies SQL puro (já portáteis)
- Server Actions, API Routes, todo código de feature
- pgvector queries (extensão habilitada no destino)
- Webhooks, jobs cron Vercel
- Frontend completo (React 19, shadcn, tokens EV, i18n)

## Referências

- [ADR 0078 — Hospedagem em duas fases (MVP Supabase → pós-MVP Oracle)](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md)
- [Sprint 19b — Migração de hospedagem](../sprints/19b-migracao-hospedagem-oracle.md)
- [docs/dev/realtime.md](realtime.md)
