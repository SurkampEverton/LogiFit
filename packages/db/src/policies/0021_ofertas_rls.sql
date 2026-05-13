-- packages/db/src/policies/0021_ofertas_rls.sql
-- Sprint 05 Faixa A — Ofertas comerciais RLS (ADR 0020 esperado).
--
-- 7 tabelas: promotions + promotion_uses + plan_items + appointment_credits
-- + credit_consumptions + referrals + referral_uses.
--
-- Isolation per-tenant (regra 1). Scope company NÃO aplicado neste sprint —
-- promoções valem para o tenant inteiro por enquanto. Sprint 06+ pode
-- adicionar `company_id` em promotions se franchise/distributed precisar.

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions FORCE ROW LEVEL SECURITY;

ALTER TABLE promotion_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_uses FORCE ROW LEVEL SECURITY;

ALTER TABLE plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_items FORCE ROW LEVEL SECURITY;

ALTER TABLE appointment_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_credits FORCE ROW LEVEL SECURITY;

ALTER TABLE credit_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_consumptions FORCE ROW LEVEL SECURITY;

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals FORCE ROW LEVEL SECURITY;

ALTER TABLE referral_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_uses FORCE ROW LEVEL SECURITY;

-- ─── GRANTs pra role logifit_app ────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON promotions TO logifit_app;
GRANT SELECT, INSERT ON promotion_uses TO logifit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_items TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON appointment_credits TO logifit_app;
GRANT SELECT, INSERT ON credit_consumptions TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON referrals TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON referral_uses TO logifit_app;

-- ─── promotions ─────────────────────────────────────────────────────────
CREATE POLICY promotions_tenant_select ON promotions
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY promotions_tenant_insert ON promotions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY promotions_tenant_update ON promotions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via archived_at.

-- ─── promotion_uses ─────────────────────────────────────────────────────
-- INSERT-only (audit append-only).
CREATE POLICY promotion_uses_tenant_select ON promotion_uses
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY promotion_uses_tenant_insert ON promotion_uses
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem UPDATE/DELETE.

-- ─── plan_items ─────────────────────────────────────────────────────────
CREATE POLICY plan_items_tenant_select ON plan_items
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY plan_items_tenant_insert ON plan_items
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY plan_items_tenant_update ON plan_items
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY plan_items_tenant_delete ON plan_items
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── appointment_credits ────────────────────────────────────────────────
CREATE POLICY credits_tenant_select ON appointment_credits
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY credits_tenant_insert ON appointment_credits
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY credits_tenant_update ON appointment_credits
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — créditos expiram (balance=0), não deletam.

-- ─── credit_consumptions ────────────────────────────────────────────────
-- INSERT-only (audit).
CREATE POLICY credit_consumptions_tenant_select ON credit_consumptions
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY credit_consumptions_tenant_insert ON credit_consumptions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem UPDATE/DELETE.

-- ─── referrals ──────────────────────────────────────────────────────────
CREATE POLICY referrals_tenant_select ON referrals
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY referrals_tenant_insert ON referrals
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY referrals_tenant_update ON referrals
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via active=false.

-- ─── referral_uses ──────────────────────────────────────────────────────
CREATE POLICY referral_uses_tenant_select ON referral_uses
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY referral_uses_tenant_insert ON referral_uses
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY referral_uses_tenant_update ON referral_uses
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
