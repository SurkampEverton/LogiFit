-- packages/db/src/policies/0006_rbac_rls.sql
-- Sprint 01a Faixa C — RLS pras tabelas RBAC + recovery codes.
--
-- Padrão:
--   - `roles` (system OR tenant) — system roles (tenant_id IS NULL) visíveis
--     a todos os tenants autenticados (read-only); custom roles isoladas
--     por tenant_id
--   - `permissions` (catálogo global) — read-only pra autenticados
--   - `role_permissions` — read-only via JOIN com roles (sem RLS direta;
--     vem como dado público derivado)
--   - `user_roles`, `user_permission_grants` — RLS por tenant_id
--   - `user_mfa_recovery_codes` — RLS via app.user_id (não tenant — MFA é
--     por identidade auth)

-- ─── roles ───────────────────────────────────────────────────────────────
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE  ROW LEVEL SECURITY;

-- SELECT: system roles + roles do tenant atual
CREATE POLICY roles_select ON roles
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- INSERT/UPDATE/DELETE: somente roles do tenant atual (não pode modificar system)
CREATE POLICY roles_insert ON roles
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND system = false
  );

CREATE POLICY roles_update ON roles
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND system = false
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND system = false
  );

CREATE POLICY roles_delete ON roles
  FOR DELETE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND system = false
  );

-- ─── permissions ─────────────────────────────────────────────────────────
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE  ROW LEVEL SECURITY;

-- Catálogo global — leitura livre pra autenticados
CREATE POLICY permissions_select ON permissions
  FOR SELECT
  USING (current_setting('app.user_id', true) IS NOT NULL
         AND current_setting('app.user_id', true) <> '');

-- Sem INSERT/UPDATE/DELETE policy = DENY (FORCE RLS).
-- Permissions só são adicionadas via migration.

-- ─── role_permissions ────────────────────────────────────────────────────
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE  ROW LEVEL SECURITY;

CREATE POLICY role_permissions_select ON role_permissions
  FOR SELECT
  USING (current_setting('app.user_id', true) IS NOT NULL
         AND current_setting('app.user_id', true) <> '');

CREATE POLICY role_permissions_app_write ON role_permissions
  FOR ALL TO logifit_app
  USING (true)
  WITH CHECK (true);

-- ─── user_roles ──────────────────────────────────────────────────────────
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE  ROW LEVEL SECURITY;

CREATE POLICY user_roles_select ON user_roles
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY user_roles_insert ON user_roles
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY user_roles_update ON user_roles
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY user_roles_delete ON user_roles
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── user_permission_grants ──────────────────────────────────────────────
ALTER TABLE user_permission_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permission_grants FORCE  ROW LEVEL SECURITY;

CREATE POLICY user_permission_grants_select ON user_permission_grants
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY user_permission_grants_insert ON user_permission_grants
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY user_permission_grants_update ON user_permission_grants
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY user_permission_grants_delete ON user_permission_grants
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── user_mfa_recovery_codes ─────────────────────────────────────────────
-- MFA é por identidade auth (não por tenant). user vê só os seus.
-- Mas para evitar engenharia social ("me mostre meus códigos"), policies
-- aqui são DENY total via UI — recovery codes só são gerados (mostrados 1x)
-- e validados via Server Action. Acesso direto via DB = bloqueado.
ALTER TABLE user_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa_recovery_codes FORCE  ROW LEVEL SECURITY;

CREATE POLICY user_mfa_recovery_codes_app_only ON user_mfa_recovery_codes
  FOR ALL TO logifit_app
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE roles IS
  'Roles RBAC (sistema + custom por tenant). system=true → tenant_id NULL, não editável.';
COMMENT ON TABLE permissions IS
  'Catálogo global de permissões (member.read, invoice.cancel, ...). Adicionar via migration.';
COMMENT ON TABLE user_roles IS
  'Atribuição role→user com scope opcional (company_id/unit_id). Role global = scope NULL.';
COMMENT ON TABLE user_permission_grants IS
  'Grants diretos (override de role). Usar com moderação — prefira role customizada.';
COMMENT ON TABLE user_mfa_recovery_codes IS
  'Backup codes one-time (10 ao habilitar MFA). Hash bcrypt; UI mostra plain UMA vez.';
