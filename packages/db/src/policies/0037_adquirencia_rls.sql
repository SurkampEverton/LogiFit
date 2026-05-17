-- packages/db/src/policies/0037_adquirencia_rls.sql
-- Sprint 18 Faixa A — Adquirência (maquininhas) RLS.
--
-- 4 tabelas: acquirer_connections + acquirer_sales + anticipations + acquirer_reconciliation_rules
--
-- **Credentials cifradas** — `acquirer_connections.credentials_encrypted` é texto
-- base64 do envelope AES-256-GCM. RLS limita ao tenant; Server Actions com
-- permission `financeiro.admin` descifram.
--
-- **acquirer_sales particionamento manual em migration futura** (regra 34 + ADR
-- 0072). RLS aplicada na tabela pai antes do PARTITION BY.
--
-- **Cross-company por franchise** (regra 25): SELECT respeita tenant; split em
-- franquia faz INSERT em ledger separado (Sprint 16 intercompany_entries), não
-- duplica acquirer_sales.

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE acquirer_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE acquirer_connections FORCE ROW LEVEL SECURITY;

ALTER TABLE acquirer_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE acquirer_sales FORCE ROW LEVEL SECURITY;

ALTER TABLE anticipations ENABLE ROW LEVEL SECURITY;
ALTER TABLE anticipations FORCE ROW LEVEL SECURITY;

ALTER TABLE acquirer_reconciliation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE acquirer_reconciliation_rules FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON acquirer_connections TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON acquirer_sales TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON anticipations TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON acquirer_reconciliation_rules TO logifit_app;

-- ─── acquirer_connections ──────────────────────────────────────────────
CREATE POLICY acq_conn_tenant_select ON acquirer_connections
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY acq_conn_tenant_insert ON acquirer_connections
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY acq_conn_tenant_update ON acquirer_connections
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── acquirer_sales ────────────────────────────────────────────────────
CREATE POLICY acq_sales_tenant_select ON acquirer_sales
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY acq_sales_tenant_insert ON acquirer_sales
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY acq_sales_tenant_update ON acquirer_sales
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── anticipations ─────────────────────────────────────────────────────
CREATE POLICY antic_tenant_select ON anticipations
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY antic_tenant_insert ON anticipations
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY antic_tenant_update ON anticipations
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── acquirer_reconciliation_rules ─────────────────────────────────────
CREATE POLICY acq_rules_tenant_select ON acquirer_reconciliation_rules
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY acq_rules_tenant_insert ON acquirer_reconciliation_rules
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY acq_rules_tenant_update ON acquirer_reconciliation_rules
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE acquirer_connections IS
  'Sprint 18 (ADR 0039 esperado) — credenciais maquininha cifradas AES-256-GCM. Provider abstrato (Cielo/Stone/Rede/GetNet/PagSeguro/Mock).';
COMMENT ON TABLE acquirer_sales IS
  'Sprint 18 — venda capturada na maquininha. NSU unique por (connection, external_id). Particionamento por trimestre (ADR 0072 + regra 34) declarado em migration manual após criação. @volume 12M+/ano.';
COMMENT ON TABLE anticipations IS
  'Sprint 18 — solicitação de antecipação de recebíveis. salesIds array de UUIDs antecipados; status pipeline requested → approved → credited.';
COMMENT ON TABLE acquirer_reconciliation_rules IS
  'Sprint 18 — DSL declarativa de match venda↔bank_transaction. Priority asc; primeira que casa aplica. Análogo a reconciliation_rules Sprint 17.';
