-- Sprint 00 — Extensões PostgreSQL canônicas.
-- Idempotente. Roda antes das migrations geradas pelo drizzle-kit.
--
-- pg_trgm   — trigram para fuzzy search (regra 30 + ADR 0062 pesquisa global)
-- unaccent  — busca sem acento ("Jose" acha "José")
-- vector    — embeddings para cache semântico IA (ADR 0064)
-- pgcrypto  — gen_random_uuid() (substitui uuid-ossp; nativo PG 13+)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
