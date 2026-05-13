-- packages/db/src/policies/0022_expire_credits.sql
-- Sprint 05 Faixa D — SQL function pra expirar créditos vencidos.
--
-- Cron diário 03:45 UTC chamando `process_expired_credits()`. Lógica:
--   - Marca `appointment_credits` cujo `expires_at < now() AND balance > 0`
--     com `balance = 0` (não deleta — audit preservado em credit_consumptions
--     não é afetado).
--
-- Idempotente: re-rodar não muda nada (filtra balance > 0).
--
-- SECURITY DEFINER + SET search_path = public (admin op cross-tenant).

CREATE OR REPLACE FUNCTION process_expired_credits()
RETURNS jsonb AS $$
DECLARE
  v_expired_count int;
  v_ids uuid[];
BEGIN
  WITH expired AS (
    UPDATE appointment_credits
       SET balance = 0,
           updated_at = now()
     WHERE balance > 0
       AND expires_at IS NOT NULL
       AND expires_at < now()
    RETURNING id
  )
  SELECT count(*)::int, coalesce(array_agg(id), ARRAY[]::uuid[])
    INTO v_expired_count, v_ids
    FROM expired;

  RETURN jsonb_build_object(
    'processed_at', now(),
    'newly_expired', v_expired_count,
    'credit_ids', to_jsonb(v_ids)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION process_expired_credits() IS
  'Sprint 05 Faixa D — marca appointment_credits expirados com balance=0. Idempotente. Cron 03:45 UTC.';
