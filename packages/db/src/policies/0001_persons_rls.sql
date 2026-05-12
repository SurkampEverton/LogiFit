-- packages/db/src/policies/0001_persons_rls.sql
-- Sprint 01a Faixa A — RLS policies para cadastro central `persons` (ADR 0047).
--
-- Padrão LogiFit:
--   - tenant_id é injetado por SET LOCAL no início de cada Server Action via
--     `set_config('app.tenant_id', $tenantId, true)`.
--   - Policies usam `current_setting('app.tenant_id', true)::uuid` (segundo
--     parâmetro true = missing_ok evita exception fora de transação).
--   - Por padrão **DENY**: tabela ganha ENABLE RLS + FORCE RLS; sem policy a
--     leitura/escrita retorna 0 rows.
--
-- Convenção: políticas separadas por verbo (SELECT/INSERT/UPDATE/DELETE) pra
-- granularidade futura (ex.: bloquear DELETE pra alguns roles).

ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons FORCE  ROW LEVEL SECURITY;

CREATE POLICY persons_tenant_isolation_select ON persons
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY persons_tenant_isolation_insert ON persons
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY persons_tenant_isolation_update ON persons
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY persons_tenant_isolation_delete ON persons
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE persons IS
  'Cadastro central PF/PJ (ADR 0047). RLS por tenant_id via app.tenant_id setting.';
