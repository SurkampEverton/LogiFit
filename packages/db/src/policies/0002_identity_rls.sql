-- packages/db/src/policies/0002_identity_rls.sql
-- Sprint 01a Faixa A — RLS policies da hierarquia organizacional.
--
-- Hierarquia (ADR 0006-0009):
--   groups (sem tenant_id — agregado; sem RLS por tenant)
--   tenants (RLS: id = current tenant)
--   companies (RLS: tenant_id = current)
--   units (RLS: tenant_id = current)
--   users (RLS: tenant_id = current)
--   user_tenants (RLS especial: user pode ver seus próprios vínculos)
--
-- `groups`: leitura aberta dentro do mesmo tenant via JOIN com tenants
-- (Sprint 01a não tem dashboard cross-group ainda; policy permite leitura
--  só do group ao qual o tenant atual pertence).

-- ─── tenants ──────────────────────────────────────────────────────────────
-- Tenant só vê a si mesmo. SELECT pode também listar os tenants do user
-- (via user_tenants) mas isso é fluxo de `/select-tenant` que opera com
-- elevação especial (Server Action lê com bypass_rls=true ou via funcão
-- SECURITY DEFINER — implementação na Faixa B).
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenants_self_select ON tenants
  FOR SELECT
  USING (id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenants_self_update ON tenants
  FOR UPDATE
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

-- ─── groups ───────────────────────────────────────────────────────────────
-- Não tem tenant_id; aplicar RLS via subquery contra tenants.
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE  ROW LEVEL SECURITY;

CREATE POLICY groups_via_tenant_select ON groups
  FOR SELECT
  USING (
    id IN (
      SELECT group_id FROM tenants
      WHERE id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- ─── companies ────────────────────────────────────────────────────────────
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE  ROW LEVEL SECURITY;

CREATE POLICY companies_tenant_isolation_select ON companies
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY companies_tenant_isolation_insert ON companies
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY companies_tenant_isolation_update ON companies
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY companies_tenant_isolation_delete ON companies
  FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── units ────────────────────────────────────────────────────────────────
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE units FORCE  ROW LEVEL SECURITY;

CREATE POLICY units_tenant_isolation_select ON units
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY units_tenant_isolation_insert ON units
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY units_tenant_isolation_update ON units
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY units_tenant_isolation_delete ON units
  FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── users ────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE  ROW LEVEL SECURITY;

CREATE POLICY users_tenant_isolation_select ON users
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY users_tenant_isolation_insert ON users
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY users_tenant_isolation_update ON users
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── user_tenants ─────────────────────────────────────────────────────────
-- Especial: o usuário precisa ver SEUS vínculos pra escolher tenant no
-- /select-tenant — mesmo SEM `app.tenant_id` setado.
-- Usar app.user_id (setado pelo middleware antes do tenant_id no fluxo
-- multi-tenant).
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenants FORCE  ROW LEVEL SECURITY;

CREATE POLICY user_tenants_self_select ON user_tenants
  FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM users
      WHERE id = current_setting('app.user_id', true)::uuid
    )
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY user_tenants_admin_write ON user_tenants
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE tenants IS
  'Contrato SaaS — RLS raiz (regra 1). Slug = subdomain (ADR 0065).';
COMMENT ON TABLE companies IS
  'Pessoa jurídica (matriz/filial) — 1 matriz por tenant (regra 21). person_id refere persons kind=pj.';
COMMENT ON TABLE units IS
  'Local físico (endereço). Sem person — herda CNPJ da company pai.';
COMMENT ON TABLE users IS
  'Operadores do sistema (não confundir com members). person_id refere persons kind=pf.';
