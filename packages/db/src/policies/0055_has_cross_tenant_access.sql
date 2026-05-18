-- packages/db/src/policies/0055_has_cross_tenant_access.sql
-- Sprint 02 fechamento — função SQL has_cross_tenant_access() (regra 42 + ADR 0077).
--
-- Caller (Server Action ou trigger de tabela clínica) chama esta função antes
-- de ler dado cross-tenant. Retorna TRUE se reader tem permissão via vínculo
-- ativo + módulo ativo + nível de dados cobre a categoria + limites duros
-- respeitados.
--
-- Lint custom `cross-tenant-read-must-log` enforça que toda query cross-tenant
-- passa por esta função + grava `patient_data_access_log`.
--
-- **5 níveis de dados** (regra 42):
--   1. Identidade (nome, contato) → identidade
--   2. Antropometria (peso, altura, %BF) → antropometria
--   3. Treino (workout, RPE, frequência) → treino
--   4. Clínico (sintomas, restrições, CIDs) → clinico
--   5. Workspace (nota privada profissional) → workspace [NUNCA cruza]
--
-- **Limites duros (NÃO cruzam tenant nem com consent)**:
--   - financeiro (categoria 'financeiro')
--   - prontuário CFM original (categoria 'prontuario_cfm_bruto'; só resumo cruza)
--   - dado de outras pessoas (categoria 'terceiros_mencionados')
--
-- Caller padrão: `SELECT has_cross_tenant_access($1, $2, $3, $4)` retorna
-- bool. Server Action que chamar precisa também inserir em
-- `patient_data_access_log` (enforçado por lint).

CREATE OR REPLACE FUNCTION has_cross_tenant_access(
  p_reader_user_id  uuid,
  p_reader_tenant_id uuid,
  p_passport_id     uuid,
  p_module          passport_module,
  p_category        text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_link_id uuid;
  v_link_module_data_levels jsonb;
  v_required_level text;
BEGIN
  -- 1. Limites duros: nunca cruzam tenant
  IF p_category IN ('financeiro', 'prontuario_cfm_bruto', 'terceiros_mencionados', 'workspace') THEN
    RETURN FALSE;
  END IF;

  -- 2. Verifica vínculo ativo (paciente passou pelo aceite do invite)
  SELECT pcl.id
    INTO v_link_id
    FROM patient_company_links pcl
    WHERE pcl.passport_passport_id = p_passport_id
      AND pcl.tenant_id = p_reader_tenant_id
      AND pcl.status = 'active'
      AND pcl.revoked_at IS NULL
    LIMIT 1;

  IF v_link_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 3. Verifica módulo autorizado (responsável técnico do módulo cadastrado)
  SELECT plm.data_levels
    INTO v_link_module_data_levels
    FROM patient_link_modules plm
    WHERE plm.link_id = v_link_id
      AND plm.module = p_module
      AND plm.status = 'active'
      AND plm.deactivated_at IS NULL
    LIMIT 1;

  IF v_link_module_data_levels IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 4. Verifica nível de dados cobre a categoria
  --    data_levels jsonb: { identidade: bool, antropometria: bool, treino: bool, clinico: bool, workspace: bool }
  --    Mapeamento categoria → nível:
  IF p_category = 'identidade' THEN
    v_required_level := 'identidade';
  ELSIF p_category = 'antropometria' THEN
    v_required_level := 'antropometria';
  ELSIF p_category = 'treino' THEN
    v_required_level := 'treino';
  ELSIF p_category = 'clinico' THEN
    v_required_level := 'clinico';
  ELSE
    -- Categoria desconhecida → fail closed
    RETURN FALSE;
  END IF;

  -- True só se data_levels[level] = true (paciente autorizou explicitamente)
  IF COALESCE((v_link_module_data_levels ->> v_required_level)::boolean, false) THEN
    -- NOTE: reader_user_id reservado para futura granularidade (Sprint 02b)
    --       — quando responsibleProfessionalUserId pode ser delegado a equipe
    PERFORM p_reader_user_id; -- silence unused-param warning
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION has_cross_tenant_access(uuid, uuid, uuid, passport_module, text) IS
  'Sprint 02 fechamento — gate de leitura cross-tenant (regra 42 + ADR 0077). Server Action chama antes de ler dado clínico/antropométrico/treino de paciente em outro tenant + grava patient_data_access_log se retornar TRUE. Limites duros (financeiro/prontuario_cfm_bruto/terceiros/workspace) sempre FALSE.';

GRANT EXECUTE ON FUNCTION has_cross_tenant_access(uuid, uuid, uuid, passport_module, text) TO logifit_app;
