-- packages/db/src/policies/0034_erp_financeiro_rls.sql
-- Sprint 15 Faixa A — ERP Financeiro Core RLS (ADR 0033 + 0034).
--
-- 6 tabelas: chart_of_accounts + suppliers + approval_rules +
-- accounts_payable + accounts_receivable + ap_ar_payments
--
-- **Scope por company** (regra 21+25): AP/AR têm company_id obrigatória.
-- Gerente de filial só vê AP/AR da própria company; diretor vê todos.
-- Server Actions verificam via `has_permission()` (ADR 0019). RLS pura
-- limita ao tenant.
--
-- **Audit obrigatório** (regra 5 + Sprint 15 doc): leituras de AP/AR e
-- aprovações registram audit_log via wrapServerAction.
--
-- **ap_ar_payments append-only**: sem UPDATE/DELETE policy. Correção via
-- pagamento negativo (estorno).

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;

ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_payable FORCE ROW LEVEL SECURITY;

ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_receivable FORCE ROW LEVEL SECURITY;

ALTER TABLE ap_ar_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_ar_payments FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON chart_of_accounts TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON suppliers TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON approval_rules TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON accounts_payable TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON accounts_receivable TO logifit_app;
GRANT SELECT, INSERT ON ap_ar_payments TO logifit_app;

-- ─── chart_of_accounts ────────────────────────────────────────────────
CREATE POLICY chart_of_accounts_tenant_select ON chart_of_accounts
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY chart_of_accounts_tenant_insert ON chart_of_accounts
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY chart_of_accounts_tenant_update ON chart_of_accounts
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via archived_at.

-- ─── suppliers ────────────────────────────────────────────────────────
CREATE POLICY suppliers_tenant_select ON suppliers
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY suppliers_tenant_insert ON suppliers
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY suppliers_tenant_update ON suppliers
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via archived_at (audit/histórico de compras).

-- ─── approval_rules ───────────────────────────────────────────────────
CREATE POLICY approval_rules_tenant_select ON approval_rules
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY approval_rules_tenant_insert ON approval_rules
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY approval_rules_tenant_update ON approval_rules
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── accounts_payable ─────────────────────────────────────────────────
CREATE POLICY accounts_payable_tenant_select ON accounts_payable
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY accounts_payable_tenant_insert ON accounts_payable
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY accounts_payable_tenant_update ON accounts_payable
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via status='cancelled' (retenção fiscal).

-- ─── accounts_receivable ──────────────────────────────────────────────
CREATE POLICY accounts_receivable_tenant_select ON accounts_receivable
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY accounts_receivable_tenant_insert ON accounts_receivable
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY accounts_receivable_tenant_update ON accounts_receivable
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── ap_ar_payments (append-only) ─────────────────────────────────────
-- Sem UPDATE/DELETE policy — correção via pagamento negativo (estorno).
CREATE POLICY ap_ar_payments_tenant_select ON ap_ar_payments
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ap_ar_payments_tenant_insert ON ap_ar_payments
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE chart_of_accounts IS
  'ADR 0033 — plano de contas hierárquico via parent_id + is_leaf. Lançamentos AP/AR só apontam pra folhas.';
COMMENT ON TABLE suppliers IS
  'Fornecedor com FK persons (ADR 0047). Identidade via JOIN — bank_account jsonb pra Open Finance Sprint 17.';
COMMENT ON TABLE approval_rules IS
  'ADR 0034 — workflow declarativo por faixa de valor + required_approvers jsonb (series/parallel).';
COMMENT ON TABLE accounts_payable IS
  'ADR 0034 state machine: draft → pending_approval → approved → scheduled → paid → reconciled. tax_nature_id pré-cabeada Sprint 15b.';
COMMENT ON TABLE accounts_receivable IS
  'AR avulso (não-contrato). invoice_id opcional para link com Sprint 04 invoices contratos.';
COMMENT ON TABLE ap_ar_payments IS
  'Pagamentos parciais append-only. source_type=ap/ar + source_id discriminam FK lógica. Estorno via amount negativo.';
