-- packages/db/src/policies/0046_cross_rls.sql
-- Sprint 27 Faixa A — Cross-alert lesão Fisio → ajuste treino Academia.
--
-- 3 tabelas: cid_exercise_contraindications + member_injury_alerts + workout_adaptations
--
-- **cid_exercise_contraindications** — biblioteca global LogiFit (tenant_id NULL)
-- + override per tenant. SELECT permite leitura global por todo logifit_app;
-- INSERT/UPDATE/DELETE só na linha do tenant. Curadoria global vai por
-- platform_admin direto no banco (mesmo padrão Sprint 11 exercises).
--
-- **member_injury_alerts** + **workout_adaptations** — tenant-scoped por
-- tenant_id (regra 1). Audit em todas mutações via audit_log (regra 5).

ALTER TABLE cid_exercise_contraindications ENABLE ROW LEVEL SECURITY;
ALTER TABLE cid_exercise_contraindications FORCE ROW LEVEL SECURITY;

ALTER TABLE member_injury_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_injury_alerts FORCE ROW LEVEL SECURITY;

ALTER TABLE workout_adaptations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_adaptations FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON cid_exercise_contraindications TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON member_injury_alerts          TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON workout_adaptations           TO logifit_app;

-- ─── cid_exercise_contraindications ──────────────────────────────────────
-- SELECT: catálogo global (tenant_id IS NULL) + override do tenant atual
CREATE POLICY cec_select_global_or_tenant ON cid_exercise_contraindications
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- INSERT: só linha com tenant_id próprio (curadoria global fora do app)
CREATE POLICY cec_insert_tenant_only ON cid_exercise_contraindications
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- UPDATE: só linha do próprio tenant
CREATE POLICY cec_update_tenant_only ON cid_exercise_contraindications
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── member_injury_alerts ────────────────────────────────────────────────
-- SELECT: staff do tenant OU paciente (próprio member_id)
CREATE POLICY mia_select_tenant_or_member ON member_injury_alerts
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = (
      SELECT id FROM members
      WHERE id = NULLIF(current_setting('app.member_id', true), '')::uuid
        AND tenant_id = member_injury_alerts.tenant_id
    )
  );

CREATE POLICY mia_insert_tenant_only ON member_injury_alerts
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY mia_update_tenant_only ON member_injury_alerts
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── workout_adaptations ─────────────────────────────────────────────────
-- SELECT: staff do tenant OU paciente do alerta vinculado
CREATE POLICY wa_select_tenant_or_member ON workout_adaptations
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR EXISTS (
      SELECT 1
      FROM member_injury_alerts mia
      WHERE mia.id = workout_adaptations.alert_id
        AND mia.member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
    )
  );

CREATE POLICY wa_insert_tenant_only ON workout_adaptations
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY wa_update_tenant_only ON workout_adaptations
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE cid_exercise_contraindications IS
  'Sprint 27 — mapeamento CID → contraindicação (global LogiFit + tenant override). ADR 0084.';
COMMENT ON TABLE member_injury_alerts IS
  'Sprint 27 — alerta cross-module Fisio→Academia. status blocked grava blocked_reason pra audit (regra 25 + consent).';
COMMENT ON TABLE workout_adaptations IS
  'Sprint 27 — sugestão de adaptação de ficha. confirm cria nova versão do workout (Sprint 11 versionamento).';
