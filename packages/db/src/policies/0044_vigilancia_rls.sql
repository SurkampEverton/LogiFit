-- packages/db/src/policies/0044_vigilancia_rls.sql
-- Sprint 25 Faixa A — ANVISA + Limpeza + CNES RLS.
--
-- 5 tabelas: equipment + equipment_maintenance + equipment_usage_log + cleaning_checklists + cleaning_logs
--
-- **equipment_usage_log** + **cleaning_logs**: APPEND-ONLY (regra 5 audit/fiscalização).
-- **equipment_maintenance**: UPDATE permitido pra transição de status (scheduled → completed).
--
-- **Coluna cnes_code em companies**: adicionada via migration manual Sprint 25b
-- (Drizzle não detecta colunas adicionadas a tabela existente em outro schema file).

ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment FORCE ROW LEVEL SECURITY;

ALTER TABLE equipment_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_maintenance FORCE ROW LEVEL SECURITY;

ALTER TABLE equipment_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_usage_log FORCE ROW LEVEL SECURITY;

ALTER TABLE cleaning_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_checklists FORCE ROW LEVEL SECURITY;

ALTER TABLE cleaning_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_logs FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON equipment TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON equipment_maintenance TO logifit_app;
-- equipment_usage_log: SEM UPDATE (append-only regra 5)
GRANT SELECT, INSERT ON equipment_usage_log TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON cleaning_checklists TO logifit_app;
-- cleaning_logs: SEM UPDATE (append-only regra 5)
GRANT SELECT, INSERT ON cleaning_logs TO logifit_app;

-- ─── equipment ─────────────────────────────────────────────────────────
CREATE POLICY eq_tenant_select ON equipment
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY eq_tenant_insert ON equipment
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY eq_tenant_update ON equipment
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── equipment_maintenance ─────────────────────────────────────────────
CREATE POLICY em_tenant_select ON equipment_maintenance
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY em_tenant_insert ON equipment_maintenance
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY em_tenant_update ON equipment_maintenance
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── equipment_usage_log (append-only) ─────────────────────────────────
CREATE POLICY eul_tenant_select ON equipment_usage_log
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY eul_tenant_insert ON equipment_usage_log
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Sem UPDATE policy (append-only)

-- ─── cleaning_checklists ───────────────────────────────────────────────
CREATE POLICY cc_tenant_select ON cleaning_checklists
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cc_tenant_insert ON cleaning_checklists
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cc_tenant_update ON cleaning_checklists
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── cleaning_logs (append-only) ───────────────────────────────────────
CREATE POLICY cl_tenant_select ON cleaning_logs
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cl_tenant_insert ON cleaning_logs
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE equipment IS
  'Sprint 25 — equipamentos regulados ANVISA. Unique global (manufacturer, serial_number).';
COMMENT ON TABLE equipment_maintenance IS
  'Sprint 25 — cronograma + execução + certificado. Fluxo manutenção externa com NF-e remessa 5.915 + retorno 1.916 (ADR 0059 Sprint 36).';
COMMENT ON TABLE equipment_usage_log IS
  'Sprint 25 APPEND-ONLY — rastreabilidade clínica ANVISA. @volume 18M+/ano particionamento manual Sprint 25b.';
COMMENT ON TABLE cleaning_checklists IS
  'Sprint 25 — templates por ambiente. items jsonb = [{key, label, required}].';
COMMENT ON TABLE cleaning_logs IS
  'Sprint 25 APPEND-ONLY — registro diário de limpeza. completion_pct calculado pela lib pura.';
