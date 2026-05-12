-- packages/db/src/policies/0013_has_permission.sql
-- Sprint 01b D.1 — função SQL has_permission() centraliza autorização (ADR 0019).
--
-- Retorna boolean — true se o user tem a permission no scope solicitado, via:
--   1. Role atribuída (user_roles → roles → role_permissions)
--   2. Grant direto (user_permission_grants)
--
-- Union dos dois caminhos. Ambos respeitam `expires_at` + `revoked_at` (grants).
--
-- **Scope matching**:
--   - `scope_type = NULL` (tenant-wide) ou scope da row é NULL → vale globalmente
--     no tenant
--   - `scope_type = 'company'` + `scope_id` → match exato com `scope_company_id`
--   - `scope_type = 'unit'` + `scope_id` → match exato com `scope_unit_id`
--
-- **SECURITY DEFINER** — bypassa RLS pra fazer lookup interno (role app não
-- tem JOIN cross-table sempre; defesa em profundidade mantida pelo input
-- ser só uuid + text fixos).
--
-- **STABLE** — Postgres pode cachear dentro de uma query (mesmo statement
-- chamando 2× tem 1 lookup).
--
-- Uso típico em policy RLS (Sprint 02+):
--   CREATE POLICY persons_write ON persons FOR INSERT WITH CHECK (
--     tenant_id = current_setting('app.tenant_id')::uuid
--     AND has_permission(
--       current_setting('app.user_id')::uuid,
--       'person.write', 'tenant', tenant_id
--     )
--   );

CREATE OR REPLACE FUNCTION has_permission(
  p_user_id uuid,
  p_permission text,
  p_scope_type text DEFAULT NULL,
  p_scope_id uuid DEFAULT NULL
)
RETURNS boolean AS $$
DECLARE
  v_has bool;
BEGIN
  -- Permission via role
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND rp.permission_key = p_permission
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND (
        -- Sem scope no user_role → vale pro tenant inteiro
        (ur.scope_company_id IS NULL AND ur.scope_unit_id IS NULL)
        OR (p_scope_type = 'company' AND ur.scope_company_id = p_scope_id)
        OR (p_scope_type = 'unit' AND ur.scope_unit_id = p_scope_id)
        OR p_scope_type IS NULL  -- caller não exigiu scope específico
      )
  ) INTO v_has;

  IF v_has THEN
    RETURN true;
  END IF;

  -- Permission via grant direto
  SELECT EXISTS (
    SELECT 1
    FROM user_permission_grants upg
    WHERE upg.user_id = p_user_id
      AND upg.permission_key = p_permission
      AND upg.revoked_at IS NULL
      AND (upg.expires_at IS NULL OR upg.expires_at > now())
      AND (
        (upg.scope_company_id IS NULL AND upg.scope_unit_id IS NULL)
        OR (p_scope_type = 'company' AND upg.scope_company_id = p_scope_id)
        OR (p_scope_type = 'unit' AND upg.scope_unit_id = p_scope_id)
        OR p_scope_type IS NULL
      )
  ) INTO v_has;

  RETURN v_has;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION has_permission(uuid, text, text, uuid) IS
  'ADR 0019 — union de user_roles + user_permission_grants ativos. Respeita scope. SECURITY DEFINER + STABLE.';
