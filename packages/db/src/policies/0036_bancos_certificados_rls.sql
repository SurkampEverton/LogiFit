-- packages/db/src/policies/0036_bancos_certificados_rls.sql
-- Sprint 17 Faixa A — Bancos + Open Finance + Certificados + NF-e cursors RLS.
--
-- 7 tabelas: bank_accounts + openfinance_connections + bank_transactions +
--            reconciliation_rules + company_certificates + nfe_sefaz_cursors
--
-- **Certificado A1 acesso restrito** — Sprint 17+ adicionará permission gate
-- `financeiro.admin` em Server Actions de leitura do PFX. RLS pura limita ao
-- tenant; Server Actions extra-validam role.
--
-- **bank_transactions** — particionamento manual em migration futura (regra 34
-- + ADR 0072). RLS aplicada na tabela pai antes do PARTITION BY.
--
-- **openfinance_connections.access_token_encrypted** — bytea/text cifrado.
-- Sem acesso direto via API; só Server Actions específicas descifram.

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE openfinance_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE openfinance_connections FORCE ROW LEVEL SECURITY;

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions FORCE ROW LEVEL SECURITY;

ALTER TABLE reconciliation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE company_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_certificates FORCE ROW LEVEL SECURITY;

ALTER TABLE nfe_sefaz_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE nfe_sefaz_cursors FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON bank_accounts TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON openfinance_connections TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON bank_transactions TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON reconciliation_rules TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON company_certificates TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON nfe_sefaz_cursors TO logifit_app;

-- ─── bank_accounts ──────────────────────────────────────────────────────
CREATE POLICY bank_accounts_tenant_select ON bank_accounts
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bank_accounts_tenant_insert ON bank_accounts
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bank_accounts_tenant_update ON bank_accounts
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── openfinance_connections ───────────────────────────────────────────
CREATE POLICY of_conn_tenant_select ON openfinance_connections
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY of_conn_tenant_insert ON openfinance_connections
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY of_conn_tenant_update ON openfinance_connections
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── bank_transactions ──────────────────────────────────────────────────
CREATE POLICY bank_tx_tenant_select ON bank_transactions
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bank_tx_tenant_insert ON bank_transactions
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bank_tx_tenant_update ON bank_transactions
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── reconciliation_rules ──────────────────────────────────────────────
CREATE POLICY rec_rules_tenant_select ON reconciliation_rules
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY rec_rules_tenant_insert ON reconciliation_rules
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY rec_rules_tenant_update ON reconciliation_rules
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── company_certificates ──────────────────────────────────────────────
CREATE POLICY cert_tenant_select ON company_certificates
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cert_tenant_insert ON company_certificates
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY cert_tenant_update ON company_certificates
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── nfe_sefaz_cursors ─────────────────────────────────────────────────
CREATE POLICY nfe_cursors_tenant_select ON nfe_sefaz_cursors
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY nfe_cursors_tenant_insert ON nfe_sefaz_cursors
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY nfe_cursors_tenant_update ON nfe_sefaz_cursors
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE bank_accounts IS
  'Sprint 17 — conta bancária por company. openfinance_connection_id linka com OAuth integration. saldo cached via sync.';
COMMENT ON TABLE openfinance_connections IS
  'Sprint 17 (ADR 0037 esperado) — OAuth tokens cifrados AES-256-GCM. Provider abstrato (Pluggy/Belvo/direto).';
COMMENT ON TABLE bank_transactions IS
  'Sprint 17 — extrato bancário. Particionamento por trimestre (ADR 0072 + regra 34) declarado em migration manual após criação.';
COMMENT ON TABLE reconciliation_rules IS
  'Sprint 17 — DSL declarativa de match automático extrato↔AP/AR. Priority ordena; primeira que casa aplica.';
COMMENT ON TABLE company_certificates IS
  'Sprint 17 (ADR 0038 esperado) — PFX A1 cifrado AES-256-GCM + senha cifrada separada. Acesso restrito a financeiro.admin via Server Action.';
COMMENT ON TABLE nfe_sefaz_cursors IS
  'Sprint 17 (ADR 0038 esperado) — cursor de sync NSU SEFAZ por (company, provider). consecutive_failures dispara alerta admin.';
