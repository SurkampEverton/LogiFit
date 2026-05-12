-- packages/db/src/policies/0010_solo_mode_check.sql
-- Sprint 01b Faixa A — check constraint ADR 0069: mode='solo' não pode ter
-- cross_company_access=true (profissional autônomo é 1 matriz / 0 filiais).

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_solo_mode_excludes_cross_company;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_solo_mode_excludes_cross_company
  CHECK (NOT (mode = 'solo' AND cross_company_access = true));

COMMENT ON CONSTRAINT tenants_solo_mode_excludes_cross_company ON tenants IS
  'ADR 0069 — Plano Solo: mode=solo é 1 matriz + 0 filiais; cross_company_access não faz sentido';
