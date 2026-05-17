-- packages/db/src/policies/0042_rh_rls.sql
-- Sprint 23 Faixa A — Comissões + repasse profissional RLS.
--
-- 4 tabelas: professional_contracts + commission_rules + commission_entries + commission_periods
-- + 1 tabela do schema rh (commission_rules) que herda RLS via JOIN com contract.

ALTER TABLE professional_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_contracts FORCE ROW LEVEL SECURITY;

ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE commission_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_entries FORCE ROW LEVEL SECURITY;

ALTER TABLE commission_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_periods FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON professional_contracts TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON commission_rules TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON commission_entries TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON commission_periods TO logifit_app;

-- ─── professional_contracts ───────────────────────────────────────────
CREATE POLICY pc_tenant_select ON professional_contracts
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY pc_tenant_insert ON professional_contracts
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY pc_tenant_update ON professional_contracts
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── commission_rules (via JOIN com contract) ───────────────────────
CREATE POLICY cr_via_contract_select ON commission_rules
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM professional_contracts pc
            WHERE pc.id = contract_id
              AND pc.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
CREATE POLICY cr_via_contract_insert ON commission_rules
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM professional_contracts pc
            WHERE pc.id = contract_id
              AND pc.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
CREATE POLICY cr_via_contract_update ON commission_rules
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM professional_contracts pc
            WHERE pc.id = contract_id
              AND pc.tenant_id = current_setting('app.tenant_id', true)::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM professional_contracts pc
            WHERE pc.id = contract_id
              AND pc.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );

-- ─── commission_entries ──────────────────────────────────────────────
CREATE POLICY ce_tenant_select ON commission_entries
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ce_tenant_insert ON commission_entries
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ce_tenant_update ON commission_entries
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── commission_periods ─────────────────────────────────────────────
CREATE POLICY cp_tenant_select ON commission_periods
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cp_tenant_insert ON commission_periods
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cp_tenant_update ON commission_periods
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE professional_contracts IS
  'Sprint 23 (ADR 0086 esperado) — contrato de comissão por person+company+service_type+version. Imutabilidade pós-approved via trigger Sprint 23b.';
COMMENT ON TABLE commission_entries IS
  'Sprint 23 — uma linha por evento (atendimento/pagamento). @volume 18M+/ano particionamento manual. Retenções placeholder MVP; ADR 0061 Sprint 23b integra calculateRetentions real.';
COMMENT ON TABLE commission_periods IS
  'Sprint 23 — fechamento mensal por (person, company, period). Status pipeline draft→approved→paid. Pagamento Asaas Sprint 23b.';
