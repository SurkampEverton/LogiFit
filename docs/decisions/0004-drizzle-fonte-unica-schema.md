# ADR 0004 — Drizzle como fonte única do schema

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

Usando Supabase, existem duas formas comuns de modelar schema: (a) escrever SQL direto + gerar tipos TS via `supabase gen types typescript`, ou (b) usar um ORM TypeScript como Drizzle para declarar o schema em TS e gerar SQL. Ter os dois ativos cria duplicação e divergências sutis.

## Decision

- **Drizzle** é a fonte única do schema — todo schema é declarado em `packages/db/schema/*.ts`.
- Migrations são geradas por `drizzle-kit` e versionadas em `packages/db/migrations/`.
- **Geração de tipos do Supabase CLI fica desabilitada** — nunca commitar `supabase/types.ts` gerado.
- RLS policies ficam em `packages/db/rls/*.sql` (não em Drizzle, que ainda tem suporte limitado a RLS) e são aplicadas via migrations manuais versionadas.
- Aplicação (Server Actions, Supabase client) usa exclusivamente os tipos do Drizzle.

## Consequences

- Zero duplicação de tipos.
- Migrations versionadas e reversíveis.
- RLS fica "fora" do Drizzle — precisa processo disciplinado para não criar tabela sem policy. Mitigado pelo teste de CI que falha se tabela nova não tem RLS.
- Onboarding do dev precisa aprender Drizzle; curva é curta, mas é curva.
- Quando Drizzle ganhar suporte maduro a RLS, migrar para consolidar. Revisitar em 12 meses.
