-- packages/db/src/policies/0009_trial_lifecycle.sql
-- Sprint 01a Faixa G — Trial 14d + retenção 30d + anonimização LGPD (ADR 0066).
--
-- Pipeline:
--   D+0   tenant criado em /signup → subscription_status='trialing', trial_ends_at=now()+14d
--   D+14  trial_ends_at passou sem conversão → status='trial_expired'
--   D+44  30 dias após expirar → anonymize_trial_data() roda:
--           - persons: name='Anonimizado', document/email/phone/address → NULL
--           - tenants.subscription_status='anonymized'
--           - audit_log entry (action='trial.anonymized', legal_basis='lgpd_art16_eliminacao')
--           - Sprint 20+: cifra-com-chave-perdida em prontuarios.content (rotação KEK)
--           - Agregados preservados: count(persons), count(companies) etc — pra
--             estatística de conversão LogiFit
--
-- Conversão antes de D+44 (status='active'): dados originais permanecem.
--
-- **SECURITY DEFINER** com `SET search_path = public` — funções rodam como
-- owner postgres pra modificar tenants/persons cross-tenant (job admin).
-- Não há SQL dinâmico: input é só uuid → seguro.
--
-- **Idempotente**: process_trial_lifecycle() pode rodar várias vezes/dia
-- sem efeito duplicado (filtra por status atual antes de mudar).

-- ─── anonymize_trial_data(tenant_id) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION anonymize_trial_data(p_tenant_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_persons_count int;
  v_companies_count int;
  v_units_count int;
  v_users_count int;
  v_already_anonymized bool;
BEGIN
  -- Defesa: confere se já não está anonymized
  SELECT subscription_status = 'anonymized' INTO v_already_anonymized
  FROM tenants WHERE id = p_tenant_id;

  IF v_already_anonymized IS NULL THEN
    RAISE EXCEPTION 'tenant % não encontrado', p_tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_already_anonymized THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'já anonymized');
  END IF;

  -- 1. Captura agregados ANTES de anonimizar (pra preservar estatística LGPD art. 12 §1)
  SELECT count(*) INTO v_persons_count FROM persons WHERE tenant_id = p_tenant_id;
  SELECT count(*) INTO v_companies_count FROM companies WHERE tenant_id = p_tenant_id;
  SELECT count(*) INTO v_units_count FROM units WHERE tenant_id = p_tenant_id;
  SELECT count(*) INTO v_users_count FROM users WHERE tenant_id = p_tenant_id;

  -- 2. NULLifica PII em persons
  --    (Sprint 20+ adiciona prontuarios + assessments com cifra-perdida)
  UPDATE persons
  SET
    name = 'Anonimizado',
    display_name = NULL,
    document = NULL,
    birth_date = NULL,
    sex = NULL,
    email = NULL,
    phone = NULL,
    address = NULL,
    notes = NULL,
    updated_at = now()
  WHERE tenant_id = p_tenant_id;

  -- 3. Atualiza subscription_status
  UPDATE tenants
  SET
    subscription_status = 'anonymized',
    updated_at = now()
  WHERE id = p_tenant_id;

  -- 4. Audit log (regra 5 + 39) — legal_basis canônico LGPD art. 16
  --    app.tenant_id é setado pelo caller (process_trial_lifecycle) antes
  INSERT INTO audit_log (
    tenant_id, action, resource_type, resource_id,
    payload, legal_basis
  ) VALUES (
    p_tenant_id,
    'trial.anonymized',
    'tenants',
    p_tenant_id::text,
    jsonb_build_object(
      'aggregates_preserved', jsonb_build_object(
        'persons_count', v_persons_count,
        'companies_count', v_companies_count,
        'units_count', v_units_count,
        'users_count', v_users_count
      ),
      'pii_fields_nullified', jsonb_build_array(
        'persons.name', 'persons.document', 'persons.email',
        'persons.phone', 'persons.address', 'persons.notes',
        'persons.birth_date', 'persons.sex', 'persons.display_name'
      )
    ),
    'lgpd_art16_eliminacao'
  );

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'anonymized', true,
    'aggregates_preserved', jsonb_build_object(
      'persons_count', v_persons_count,
      'companies_count', v_companies_count,
      'units_count', v_units_count,
      'users_count', v_users_count
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION anonymize_trial_data(uuid) IS
  'ADR 0066 — anonimização LGPD art. 16 de trial expirado +30d. Preserva agregados; NULLifica PII em persons; muda subscription_status=anonymized; grava audit_log com legal_basis=lgpd_art16_eliminacao.';

-- ─── process_trial_lifecycle() ────────────────────────────────────────────
-- Job idempotente: aplica transições de estado conforme trial_ends_at:
--   trialing + trial_ends_at < now()             → trial_expired
--   trial_expired + trial_ends_at + 30d < now()  → chama anonymize_trial_data
--
-- Retorna jsonb com summary das ações pra Server Action logar.
CREATE OR REPLACE FUNCTION process_trial_lifecycle()
RETURNS jsonb AS $$
DECLARE
  v_expired_count int := 0;
  v_anonymized_count int := 0;
  v_anonymized_ids uuid[] := '{}';
  r record;
BEGIN
  -- 1. Marca trials expirados (D+14): status='trialing' → 'trial_expired'
  WITH expired AS (
    UPDATE tenants
    SET subscription_status = 'trial_expired', updated_at = now()
    WHERE subscription_status = 'trialing'
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at < now()
    RETURNING id
  )
  SELECT count(*) INTO v_expired_count FROM expired;

  -- 2. Anonimiza trials retidos por 30+ dias (D+44): status='trial_expired'
  --    AND trial_ends_at + 30d < now() AND subscription_status ≠ 'anonymized'
  FOR r IN
    SELECT id FROM tenants
    WHERE subscription_status = 'trial_expired'
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at + interval '30 days' < now()
  LOOP
    PERFORM anonymize_trial_data(r.id);
    v_anonymized_count := v_anonymized_count + 1;
    v_anonymized_ids := array_append(v_anonymized_ids, r.id);
  END LOOP;

  RETURN jsonb_build_object(
    'processed_at', now(),
    'newly_expired', v_expired_count,
    'newly_anonymized', v_anonymized_count,
    'anonymized_tenant_ids', to_jsonb(v_anonymized_ids)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION process_trial_lifecycle() IS
  'ADR 0066 — job idempotente diário. D+14 trial → trial_expired; D+44 → anonymize_trial_data. Retorna summary jsonb.';
