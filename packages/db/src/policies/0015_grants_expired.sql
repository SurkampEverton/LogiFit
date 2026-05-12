-- packages/db/src/policies/0015_grants_expired.sql
-- Sprint 01b D.6 — cron job mark-grants-expired (ADR 0019).
--
-- `has_permission()` (0013) já ignora grants com `expires_at < now()` na avaliação
-- de policy. Esta function é o "limpa-cosmética" que marca explicitamente
-- `revoked_at = now()` + `revoked_reason = 'expired'` para grants vencidos
-- — UI passa a mostrar "expirado" em vez de "ativo desconhecido", e o histórico
-- fica auditável.
--
-- **Idempotente** — filtra por `revoked_at IS NULL AND expires_at < now()`,
-- então rerodar não-causa-efeito-duplicado.
--
-- **SECURITY DEFINER** com `SET search_path = public` — admin operation
-- cross-tenant (cron sem contexto de tenant). Input é zero (sem SQL dinâmico).
--
-- Cron diário 03:15 UTC (offset de 15min do trial-lifecycle pra evitar
-- contenção de pool). Sprint 03+ daemon `node-cron`/`ofelia` orquestra.

CREATE OR REPLACE FUNCTION process_grants_expired()
RETURNS jsonb AS $$
DECLARE
  v_marked_count int;
  v_ids uuid[];
BEGIN
  WITH expired AS (
    UPDATE user_permission_grants
       SET revoked_at = now(),
           revoked_reason = 'expired'
     WHERE revoked_at IS NULL
       AND expires_at IS NOT NULL
       AND expires_at < now()
    RETURNING id
  )
  SELECT count(*)::int, coalesce(array_agg(id), ARRAY[]::uuid[])
    INTO v_marked_count, v_ids
    FROM expired;

  RETURN jsonb_build_object(
    'processed_at', now(),
    'newly_revoked', v_marked_count,
    'revoked_grant_ids', to_jsonb(v_ids)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION process_grants_expired() IS
  'Sprint 01b D.6 — marca user_permission_grants com expires_at<now() como revoked. Idempotente. Cron 03:15 UTC.';
