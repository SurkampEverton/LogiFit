-- packages/db/src/policies/0016_list_user_permissions.sql
-- Sprint 00b Faixa C — bulk lookup de permissions ativas do user no tenant (ADR 0019).
--
-- `has_permission()` (0013) responde 1 pergunta: "esse user tem permission X?".
-- Para popular o `<AppShell>` SideMenu (regra 1+30), precisamos da lista COMPLETA
-- de permissions ativas pra um (user, tenant). Chamar has_permission() N vezes
-- numa render seria 30+ round-trips. `list_user_permissions()` faz em 1 query
-- só, agregando via DISTINCT array.
--
-- Retorna array de `permission_key` text:
--   - via role: `user_roles → roles → role_permissions`
--   - via grant direto: `user_permission_grants`
-- Ambos respeitam `expires_at` + `revoked_at` (grants).
--
-- **Scope ignorado neste nível** — chamador filtra scope quando preciso (ex:
-- "tenant_owner em qualquer scope = vê tudo no tenant"). Sprint 04+ amplia se
-- precisar de scope-aware bulk lookup pra UI de gestão de equipes/units.
--
-- **SECURITY DEFINER** + `STABLE` (mesmo padrão de 0013).

CREATE OR REPLACE FUNCTION list_user_permissions(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS text[] AS $$
DECLARE
  v_perms text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT permission_key), ARRAY[]::text[])
    INTO v_perms
    FROM (
      -- Path 1: via role atribuída ao user no tenant
      SELECT rp.permission_key
        FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE ur.user_id = p_user_id
         AND ur.tenant_id = p_tenant_id
         AND (ur.expires_at IS NULL OR ur.expires_at > now())

      UNION

      -- Path 2: via grant direto ativo
      SELECT upg.permission_key
        FROM user_permission_grants upg
       WHERE upg.user_id = p_user_id
         AND upg.tenant_id = p_tenant_id
         AND upg.revoked_at IS NULL
         AND (upg.expires_at IS NULL OR upg.expires_at > now())
    ) AS active;

  RETURN v_perms;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION list_user_permissions(uuid, uuid) IS
  'Sprint 00b Faixa C — array DISTINCT de permission_key ativas (via role + grant direto). Scope-agnostic. SECURITY DEFINER + STABLE.';
