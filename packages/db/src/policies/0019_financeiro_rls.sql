-- packages/db/src/policies/0019_financeiro_rls.sql
-- Sprint 04 Faixa A — Financeiro Asaas RLS (ADR 0013 + 0014 esperados).
--
-- 6 tabelas: plans / contracts / invoices / payments / asaas_keys / webhook_events.
-- Isolamento por tenant_id (regra 1). Scope company/unit aplicado em policies
-- futuras quando role financeiro chegar (Sprint 04 Faixa B).
--
-- **asaas_keys check constraint**: enforça regra ADR 0014 — centralized → 1
-- chave com company_id NULL; distributed → N chaves com company_id NOT NULL.
-- Per-tenant validado via subquery em tenant.financial_mode (Sprint 04 Faixa B
-- adiciona trigger pra defesa em profundidade).
--
-- **webhook_events**: SEM RLS — endpoint público recebe webhooks sem auth.
-- Processor faz lookup do tenant via payload e cria invoices/payments scoped.
-- Tabela técnica (não-dado-tenant) — semelhante a auth_attempts.

-- ─── Ativa RLS + FORCE em todas as tabelas tenant-scoped ────────────────
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans FORCE ROW LEVEL SECURITY;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

ALTER TABLE asaas_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE asaas_keys FORCE ROW LEVEL SECURITY;

-- webhook_events SEM RLS — sem tenant_id obrigatório, recebe ANTES de
-- resolver tenant; processor faz lookup via payload (sandbox sem RLS bypass)

-- ─── GRANTs pra role logifit_app ─────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON plans TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON contracts TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON invoices TO logifit_app;
GRANT SELECT, INSERT ON payments TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON asaas_keys TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON webhook_events TO logifit_app;

-- ─── plans policies ──────────────────────────────────────────────────────
CREATE POLICY plans_tenant_isolation_select ON plans
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY plans_tenant_isolation_insert ON plans
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY plans_tenant_isolation_update ON plans
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft-delete via `archived_at`.

-- ─── contracts policies ─────────────────────────────────────────────────
CREATE POLICY contracts_tenant_isolation_select ON contracts
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY contracts_tenant_isolation_insert ON contracts
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY contracts_tenant_isolation_update ON contracts
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — cancelled vira status, mantém histórico fiscal.

-- ─── invoices policies ──────────────────────────────────────────────────
CREATE POLICY invoices_tenant_isolation_select ON invoices
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY invoices_tenant_isolation_insert ON invoices
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY invoices_tenant_isolation_update ON invoices
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — invoice tem efeito fiscal; cancelled vira status.

-- ─── payments policies ──────────────────────────────────────────────────
-- INSERT-only — payment vem do webhook Asaas, é fato consumado.
CREATE POLICY payments_tenant_isolation_select ON payments
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY payments_tenant_isolation_insert ON payments
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem UPDATE/DELETE — payments são append-only (auditoria fiscal).

-- ─── asaas_keys policies ────────────────────────────────────────────────
-- Acesso restrito — Sprint 04 Faixa B adiciona permission gate `tenant.settings`.
CREATE POLICY asaas_keys_tenant_isolation_select ON asaas_keys
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY asaas_keys_tenant_isolation_insert ON asaas_keys
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY asaas_keys_tenant_isolation_update ON asaas_keys
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── webhook_events: GRANTS sem RLS ─────────────────────────────────────
-- Processador faz lookup via payload — tabela técnica. Sprint 04+ Faixa B
-- adiciona view scoped `tenant_webhook_events` que aplica filtro tenant_id
-- pra UI consultar (debugging webhook flow).
