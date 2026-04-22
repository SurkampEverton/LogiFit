# Sprint 00 — Setup de Infra

- **Início:** planejado
- **Fim planejado:** +2 semanas
- **Status:** planejado
- **Item do roadmap:** #1

## Goal

Monorepo funcional, Supabase local rodando, CI verde, observabilidade ligada. Zero feature de negócio.

## Critério de aceite

- `pnpm dev` abre Next.js em `localhost:3000`
- `pnpm test` roda Vitest verde
- `pnpm db:migrate` aplica migrations Drizzle no Supabase local
- CI (GitHub Actions) passa: type-check, Biome, Vitest, drizzle migrate dry-run, teste de RLS placeholder
- Sentry captura erro sintético em dev
- PostHog registra pageview
- Tokens "Equilíbrio Vital" aplicados em componente de teste (light/dark sem sombras residuais)

## Dependências

- Nenhuma (é o primeiro sprint)

## Decisões tomadas

- [ADR 0001 — Stack base](../decisions/0001-stack-base.md)
- [ADR 0004 — Drizzle como fonte única do schema](../decisions/0004-drizzle-fonte-unica-schema.md)

## Commit

- [ ] Turborepo + pnpm workspace inicializado
- [ ] `apps/web` com Next.js 15 + React 19 + Tailwind v4
- [ ] `packages/db` (Drizzle + supabase-js wrapper)
- [ ] `packages/ui` (shadcn custom + tokens "Equilíbrio Vital")
- [ ] `packages/ai` (Vercel AI SDK wrappers — esqueleto)
- [ ] `packages/types` (schemas Zod compartilhados — esqueleto)
- [ ] `packages/config` (tsconfig base + biome.json)
- [ ] Supabase CLI + docker-compose local
- [ ] Drizzle config + migration runner
- [ ] CI GitHub Actions (`.github/workflows/ci.yml`)
- [ ] Sentry + PostHog integrados em `app/layout.tsx`
- [ ] `biome.json` + pre-commit hook (opcional)
- [ ] README atualizado com `pnpm dev`, `pnpm test`, etc.

## Stretch

- [ ] Logtail/Axiom para logs estruturados
- [ ] Storybook para `packages/ui`

## Log

- —

## Definition of Done

- [ ] pnpm dev funciona
- [ ] pnpm test verde
- [ ] CI verde no branch
- [ ] Sentry + PostHog capturando em dev
- [ ] Tokens "Equilíbrio Vital" aplicados sem sombras residuais do shadcn
- [ ] CHANGELOG.md entrada `[Unreleased] - Added — Monorepo, CI, observabilidade`
- [ ] Roadmap atualizado (item #1 → done)

## Retro

- —
