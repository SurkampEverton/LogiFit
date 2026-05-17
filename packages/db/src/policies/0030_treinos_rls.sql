-- packages/db/src/policies/0030_treinos_rls.sql
-- Sprint 11 Faixa A — Treinos RLS (ADR 0023 esperado).
--
-- 6 tabelas: exercises (com biblioteca global tenant_id IS NULL) + workouts
-- + workout_items + prescriptions + workout_sessions + workout_session_items
--
-- **Biblioteca global** (exercises.tenant_id IS NULL): SELECT liberado pra
-- todo logifit_app (read-only). INSERT/UPDATE bloqueado nesse modo — apenas
-- curador da plataforma (role direto no banco) seeda templates. Tenants criam
-- exercícios próprios com tenant_id NOT NULL.
--
-- **workout_session_items**: RLS por tenant_id. Sem UPDATE/DELETE — registro
-- de execução é imutável após inserção (audit-like).

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises FORCE ROW LEVEL SECURITY;

ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workouts FORCE ROW LEVEL SECURITY;

ALTER TABLE workout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_items FORCE ROW LEVEL SECURITY;

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions FORCE ROW LEVEL SECURITY;

ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE workout_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_session_items FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON exercises TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON workouts TO logifit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workout_items TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON prescriptions TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON workout_sessions TO logifit_app;
GRANT SELECT, INSERT ON workout_session_items TO logifit_app;

-- ─── exercises ──────────────────────────────────────────────────────────
-- SELECT: tenant próprio OU biblioteca global (tenant_id NULL)
CREATE POLICY exercises_select ON exercises
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- INSERT: apenas com tenant_id próprio (biblioteca global é seedada fora do app)
CREATE POLICY exercises_insert ON exercises
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- UPDATE: só do próprio tenant (não pode editar globais)
CREATE POLICY exercises_update ON exercises
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via archived_at.

-- ─── workouts ───────────────────────────────────────────────────────────
CREATE POLICY workouts_tenant_select ON workouts
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY workouts_tenant_insert ON workouts
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY workouts_tenant_update ON workouts
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via archived_at + versionamento.

-- ─── workout_items ──────────────────────────────────────────────────────
CREATE POLICY workout_items_tenant_select ON workout_items
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY workout_items_tenant_insert ON workout_items
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY workout_items_tenant_update ON workout_items
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- DELETE permitido pra cascade de workout (CREATE/EDIT recria itens).
CREATE POLICY workout_items_tenant_delete ON workout_items
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── prescriptions ──────────────────────────────────────────────────────
CREATE POLICY prescriptions_tenant_select ON prescriptions
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY prescriptions_tenant_insert ON prescriptions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY prescriptions_tenant_update ON prescriptions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via active=false / ends_at.

-- ─── workout_sessions ───────────────────────────────────────────────────
CREATE POLICY workout_sessions_tenant_select ON workout_sessions
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY workout_sessions_tenant_insert ON workout_sessions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY workout_sessions_tenant_update ON workout_sessions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — execução é histórico imutável.

-- ─── workout_session_items (append-only após INSERT) ────────────────────
-- Sem UPDATE/DELETE — registro de série é imutável (audit-like, regra 5 spirit)
CREATE POLICY workout_session_items_tenant_select ON workout_session_items
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY workout_session_items_tenant_insert ON workout_session_items
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── COMMENTS ───────────────────────────────────────────────────────────
COMMENT ON TABLE exercises IS
  'Catálogo de exercícios. tenant_id NULL = biblioteca global LogiFit (read-only via RLS). met_value Compendium 2024 (ADR 0070).';
COMMENT ON TABLE workouts IS
  'Templates de treino por tenant. Versionado via parent_workout_id — edição cria nova row.';
COMMENT ON TABLE prescriptions IS
  'ADR 0023 — base polimórfica (kind ∈ workout/meal_plan/fisio_protocol/custom). Sprint 11 entrega kind=workout; meal_plan Sprint 29, fisio_protocol Sprint 20.';
COMMENT ON TABLE workout_sessions IS
  'Execução de sessão. calculated_kcal preenchido em finishSession via calculateKcalPerSession. RPE Borg CR-10.';
COMMENT ON TABLE workout_session_items IS
  'Registro set-a-set. Append-only enforced via ausência de UPDATE/DELETE policy (audit-like).';
