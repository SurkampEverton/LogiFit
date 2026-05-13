-- packages/db/src/policies/0020_create_recurring_invoices.sql
-- Sprint 04 Faixa D — SQL function pra gerar próximas invoices pendentes.
--
-- Cron job `POST /api/jobs/billing/daily` (03:30 UTC, offset 15min de
-- process-grants-expired) chama esta function. Lógica:
--
--   1. Para cada contract `active` cujo billing_day = day(today + 5d):
--   2. Verifica se já existe invoice pra esse contract com due_at no mês corrente +5d
--   3. Se não existe: cria invoice `pending` com amount_cents = plan.price_cents,
--      breakdown jsonb canonical, due_at = data calculada
--
-- Idempotente: re-rodar mesmo dia não duplica (filtra via NOT EXISTS).
--
-- **SECURITY DEFINER** + `SET search_path = public` — admin op cross-tenant
-- (cron sem app.tenant_id setado).

CREATE OR REPLACE FUNCTION create_recurring_invoices()
RETURNS jsonb AS $$
DECLARE
  v_created_count int;
  v_target_due_day int;
  v_now timestamptz := now();
  v_ids uuid[];
BEGIN
  -- Job roda D-5 do vencimento — target = day(now + 5d)
  v_target_due_day := EXTRACT(DAY FROM (v_now + interval '5 days'))::int;

  WITH new_invoices AS (
    INSERT INTO invoices (
      tenant_id, company_id, contract_id, member_id, amount_cents,
      due_at, status, breakdown
    )
    SELECT
      c.tenant_id,
      c.company_id,
      c.id,
      c.member_id,
      p.price_cents,
      -- due_at = 1º dia do próximo mês com day=billing_day se billing_day já passou
      -- nesse mês; senão, billing_day deste mês
      (date_trunc('month', v_now)
        + ((c.billing_day - 1) || ' days')::interval
        + CASE
            WHEN EXTRACT(DAY FROM v_now)::int >= c.billing_day THEN interval '1 month'
            ELSE interval '0 days'
          END
      )::timestamptz,
      'pending',
      jsonb_build_object(
        'base', p.price_cents,
        'overage_items', '[]'::jsonb,
        'discounts', '[]'::jsonb,
        'surcharges', '[]'::jsonb,
        'generated_by', 'cron:billing.daily',
        'generated_at', v_now
      )
    FROM contracts c
    JOIN plans p ON p.id = c.plan_id
    WHERE c.status = 'active'
      AND c.billing_day = v_target_due_day
      -- Não duplica: skip se já existe invoice pendente futura pro contract
      AND NOT EXISTS (
        SELECT 1 FROM invoices i
        WHERE i.contract_id = c.id
          AND i.status IN ('pending', 'paid', 'overdue')
          AND i.due_at > v_now
          AND i.due_at < v_now + interval '35 days'
      )
    RETURNING id
  )
  SELECT count(*)::int, coalesce(array_agg(id), ARRAY[]::uuid[])
    INTO v_created_count, v_ids
    FROM new_invoices;

  RETURN jsonb_build_object(
    'processed_at', v_now,
    'target_billing_day', v_target_due_day,
    'newly_created', v_created_count,
    'invoice_ids', to_jsonb(v_ids)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION create_recurring_invoices() IS
  'Sprint 04 Faixa D — gera invoices D-5 do billing_day para contracts active. Idempotente.';
