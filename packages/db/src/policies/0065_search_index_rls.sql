-- packages/db/src/policies/0065_search_index_rls.sql
-- ADR 0062 fase 1 — RLS do search_index.
--
-- App só LÊ (SELECT); escrita acontece exclusivamente pelas funções
-- SECURITY DEFINER (search_index_upsert/delete) disparadas por trigger das
-- tabelas-fonte. Filtro fino de permission (required_permission) acontece na
-- API /api/search via has_permission() — a RLS garante o isolamento de tenant.

ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_index FORCE ROW LEVEL SECURITY;

GRANT SELECT ON search_index TO logifit_app;

CREATE POLICY search_index_select ON search_index
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
