-- packages/db/src/policies/0004_person_kind_check.sql
-- Sprint 01a Faixa A — constraints comportamentais via trigger.
--
-- Regras (ADR 0047 + sprint 01a):
--   1. `companies.person_id` deve apontar pra persons com `kind = 'pj'`
--   2. `users.person_id` deve apontar pra persons com `kind = 'pf'`
--   3. `companies.parent_company_id` (filial) → company pai do mesmo tenant
--      com type='matriz' (regra 21)
--
-- Não conseguimos expressar (1) e (2) como CHECK constraint puro porque a
-- check column é em OUTRA tabela. Solução canônica Postgres: trigger BEFORE
-- INSERT/UPDATE que valida e raise exception.

-- ─── 1. companies.person_id kind=pj ──────────────────────────────────────
CREATE OR REPLACE FUNCTION check_company_person_kind_pj()
RETURNS TRIGGER AS $$
DECLARE
  v_kind person_kind;
BEGIN
  SELECT kind INTO v_kind FROM persons WHERE id = NEW.person_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'person_id % não existe', NEW.person_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_kind <> 'pj' THEN
    RAISE EXCEPTION 'companies.person_id deve apontar pra persons kind=pj (got %)', v_kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_person_kind_pj ON companies;
CREATE TRIGGER trg_companies_person_kind_pj
  BEFORE INSERT OR UPDATE OF person_id ON companies
  FOR EACH ROW
  EXECUTE FUNCTION check_company_person_kind_pj();

-- ─── 2. users.person_id kind=pf ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_user_person_kind_pf()
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
    RAISE EXCEPTION 'users.person_id deve apontar pra persons kind=pf (got %)', v_kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_person_kind_pf ON users;
CREATE TRIGGER trg_users_person_kind_pf
  BEFORE INSERT OR UPDATE OF person_id ON users
  FOR EACH ROW
  EXECUTE FUNCTION check_user_person_kind_pf();

-- ─── 3. companies.parent_company_id → matriz mesmo tenant ────────────────
CREATE OR REPLACE FUNCTION check_company_parent_is_matriz()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_type company_type;
  v_parent_tenant uuid;
BEGIN
  -- Filial sem parent é erro
  IF NEW.type = 'filial' AND NEW.parent_company_id IS NULL THEN
    RAISE EXCEPTION 'filial exige parent_company_id (matriz do mesmo tenant)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Matriz não tem parent
  IF NEW.type = 'matriz' AND NEW.parent_company_id IS NOT NULL THEN
    RAISE EXCEPTION 'matriz não pode ter parent_company_id'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Se filial, parent deve ser matriz E do mesmo tenant
  IF NEW.parent_company_id IS NOT NULL THEN
    SELECT type, tenant_id INTO v_parent_type, v_parent_tenant
    FROM companies WHERE id = NEW.parent_company_id;

    IF v_parent_type IS NULL THEN
      RAISE EXCEPTION 'parent_company_id % não existe', NEW.parent_company_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_parent_type <> 'matriz' THEN
      RAISE EXCEPTION 'parent_company_id deve apontar pra company type=matriz (got %)', v_parent_type
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_parent_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'parent_company_id deve ser do mesmo tenant'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_parent_is_matriz ON companies;
CREATE TRIGGER trg_companies_parent_is_matriz
  BEFORE INSERT OR UPDATE OF type, parent_company_id ON companies
  FOR EACH ROW
  EXECUTE FUNCTION check_company_parent_is_matriz();

COMMENT ON FUNCTION check_company_person_kind_pj() IS
  'Constraint ADR 0047: companies.person_id sempre aponta pra persons kind=pj';
COMMENT ON FUNCTION check_user_person_kind_pf() IS
  'Constraint ADR 0047: users.person_id sempre aponta pra persons kind=pf';
COMMENT ON FUNCTION check_company_parent_is_matriz() IS
  'Constraint regra 21: filial → matriz do mesmo tenant; matriz sem parent';
