-- packages/db/src/policies/0060_feature_flags.sql
-- Sprint 02b7 — feature_flags GRANTs (ADR 0098).
--
-- Sem RLS — tabela GLOBAL (sem tenant_id). Apenas super_admin altera
-- (MVP via SQL direto; Sprint 02b7+ UI admin enforça via Server Action
-- com requireRole('super_admin') wrap).
--
-- App lê via pool.query (cache 60s no helper apps/web/app/lib/feature-flags.ts).

GRANT SELECT, INSERT, UPDATE ON feature_flags TO logifit_app;

COMMENT ON TABLE feature_flags IS
  'Sprint 02b7 (ADR 0098) — feature flags globais. Sem RLS — auth via super_admin role no app layer. Cache helper 60s TTL.';
