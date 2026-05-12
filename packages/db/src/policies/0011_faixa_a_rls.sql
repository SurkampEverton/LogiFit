-- packages/db/src/policies/0011_faixa_a_rls.sql
-- Sprint 01b Faixa A — RLS pras 3 tabelas novas: professional_registrations,
-- franchise_agreements, consents.
--
-- Padrão herdado do Sprint 01a Faixa A: ENABLE + FORCE RLS + 4 policies CRUD
-- com `tenant_id = current_setting('app.tenant_id')`. Sprint 01b Faixa B
-- adicionará `has_permission()` check no WITH CHECK das writes (ADR 0019).

-- ─── professional_registrations ──────────────────────────────────────────
ALTER TABLE professional_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_registrations FORCE  ROW LEVEL SECURITY;

CREATE POLICY professional_registrations_select ON professional_registrations
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY professional_registrations_insert ON professional_registrations
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY professional_registrations_update ON professional_registrations
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY professional_registrations_delete ON professional_registrations
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── Constraint comportamental: person_id kind=pf (trigger ADR 0047) ─────
-- professional_registrations só pra pessoas físicas
CREATE OR REPLACE FUNCTION check_professional_registration_kind_pf()
RETURNS TRIGGER AS $$
DECLARE
  v_kind person_kind;
BEGIN
  SELECT kind INTO v_kind FROM persons WHERE id = NEW.person_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'person_id % não existe', NEW.person_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_kind <> 'pf' THEN
    RAISE EXCEPTION 'professional_registrations.person_id deve ser kind=pf (got %)', v_kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_professional_registrations_kind_pf ON professional_registrations;
CREATE TRIGGER trg_professional_registrations_kind_pf
  BEFORE INSERT OR UPDATE OF person_id ON professional_registrations
  FOR EACH ROW
  EXECUTE FUNCTION check_professional_registration_kind_pf();

-- ─── franchise_agreements ────────────────────────────────────────────────
ALTER TABLE franchise_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE franchise_agreements FORCE  ROW LEVEL SECURITY;

CREATE POLICY franchise_agreements_select ON franchise_agreements
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY franchise_agreements_insert ON franchise_agreements
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY franchise_agreements_update ON franchise_agreements
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- DELETE não permitido — terminação via terminated_at = now() (preserva histórico)

-- ─── consents ───────────────────────────────────────────────────────────
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE  ROW LEVEL SECURITY;

CREATE POLICY consents_select ON consents
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY consents_insert ON consents
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- consents NÃO tem UPDATE — revogação = INSERT nova row com revoked_at setado
-- (preserva trilha histórica LGPD art. 8 § 2 — revogação não apaga prova de consent passado)

COMMENT ON TABLE professional_registrations IS
  'ADR 0055 — registros profissionais em conselho. Constraint global unique (council_body, council_number, council_state) detecta fraude.';
COMMENT ON TABLE franchise_agreements IS
  'ADR 0007 — contratos franqueador↔franqueado. cross_company_access cobre só financeiro + passaporte aluno (regra 25: clínico NÃO cruza).';
COMMENT ON TABLE consents IS
  'LGPD art. 8 — consent granular por finalidade. Revogação = INSERT nova row com revoked_at (preserva histórico).';
