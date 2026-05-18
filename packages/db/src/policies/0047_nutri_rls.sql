-- packages/db/src/policies/0047_nutri_rls.sql
-- Sprint 29 Faixa A — Nutri: foods + meal_plans + tenant_branding.
--
-- 7 tabelas:
--   - foods: global (tenant_id IS NULL) read-all + tenant custom (tenant scope)
--   - food_measures: lookup pelo foods (mesma RLS herdada)
--   - food_equivalences: global + tenant override
--   - meal_plans: tenant-scoped + member portal (via app.member_id)
--   - meal_plan_meals: herda via meal_plan_id
--   - meal_items: herda via meal_id
--   - tenant_branding: 1 row por tenant (tenant scope only)
--
-- Regra 25 (franchise) aplica em meal_plans (dado clínico — não cruza company
-- em topology=franchise). Sprint 29b adiciona company_id em meal_plans
-- pra enforce mais fino.

ALTER TABLE foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE foods FORCE ROW LEVEL SECURITY;
ALTER TABLE food_measures ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_measures FORCE ROW LEVEL SECURITY;
ALTER TABLE food_equivalences ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_equivalences FORCE ROW LEVEL SECURITY;
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_meals FORCE ROW LEVEL SECURITY;
ALTER TABLE meal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_items FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_branding FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON foods             TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON food_measures     TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON food_equivalences TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON meal_plans        TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON meal_plan_meals   TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON meal_items        TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON tenant_branding   TO logifit_app;

-- ─── foods ───────────────────────────────────────────────────────────────
-- SELECT: global (tenant_id IS NULL) OU tenant atual
CREATE POLICY foods_select_global_or_tenant ON foods
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY foods_insert_tenant_only ON foods
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY foods_update_tenant_only ON foods
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── food_measures ───────────────────────────────────────────────────────
-- SELECT: via lookup do food (global ou tenant); INSERT/UPDATE só pra foods do tenant
CREATE POLICY food_measures_select ON food_measures
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM foods f
      WHERE f.id = food_measures.food_id
        AND (f.tenant_id IS NULL OR f.tenant_id = current_setting('app.tenant_id', true)::uuid)
    )
  );

CREATE POLICY food_measures_insert ON food_measures
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM foods f
      WHERE f.id = food_measures.food_id
        AND f.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY food_measures_update ON food_measures
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM foods f
      WHERE f.id = food_measures.food_id
        AND f.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- ─── food_equivalences ───────────────────────────────────────────────────
CREATE POLICY food_equiv_select ON food_equivalences
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY food_equiv_insert ON food_equivalences
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY food_equiv_update ON food_equivalences
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── meal_plans ──────────────────────────────────────────────────────────
-- SELECT: staff do tenant OU member dono (via app.member_id; portal Sprint 26)
CREATE POLICY meal_plans_select_tenant_or_member ON meal_plans
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY meal_plans_insert_tenant_only ON meal_plans
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY meal_plans_update_tenant_only ON meal_plans
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── meal_plan_meals ─────────────────────────────────────────────────────
CREATE POLICY meal_plan_meals_select ON meal_plan_meals
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR EXISTS (
      SELECT 1 FROM meal_plans mp
      WHERE mp.id = meal_plan_meals.meal_plan_id
        AND mp.member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
    )
  );

CREATE POLICY meal_plan_meals_insert ON meal_plan_meals
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY meal_plan_meals_update ON meal_plan_meals
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── meal_items ──────────────────────────────────────────────────────────
CREATE POLICY meal_items_select ON meal_items
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR EXISTS (
      SELECT 1 FROM meal_plan_meals mpm
      INNER JOIN meal_plans mp ON mp.id = mpm.meal_plan_id
      WHERE mpm.id = meal_items.meal_id
        AND mp.member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
    )
  );

CREATE POLICY meal_items_insert ON meal_items
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY meal_items_update ON meal_items
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── tenant_branding ─────────────────────────────────────────────────────
CREATE POLICY tenant_branding_select ON tenant_branding
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_branding_upsert ON tenant_branding
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_branding_update ON tenant_branding
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE foods IS
  'Sprint 29 — banco de alimentos TACO/USDA global (tenant_id NULL) + tenant custom. nutrients jsonb validado por Zod. ADR 0080.';
COMMENT ON TABLE meal_plans IS
  'Sprint 29 — plano alimentar versionado (parent_meal_plan_id) polimórfico com Sprint 11 prescriptions kind=meal_plan. Member vê via portal Sprint 26. ADR 0081.';
COMMENT ON TABLE tenant_branding IS
  'Sprint 29 — logo + cores + assinatura digitalizada do tenant; usado em geração de PDF.';
