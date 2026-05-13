-- packages/db/src/policies/0025_acesso_rls.sql
-- Sprint 08 Faixa A — Academia controle acesso RLS (ADR 0017+0018 esperados).
--
-- 4 tabelas: access_devices + access_secrets + access_events + access_blocks.
-- Isolation per-tenant; scope company/unit via JOIN (Sprint 09+ Faixa C
-- adiciona policies scope-aware quando role recepcao/gerente entrar).
--
-- access_events e access_secrets têm pattern especial:
-- - access_events: APPEND-ONLY (sem UPDATE/DELETE)
-- - access_secrets: secret é segredo; SELECT só pra logifit_app autenticado +
--   service role (catraca usa device_token, não bate em access_secrets direto)

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE access_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_devices FORCE ROW LEVEL SECURITY;

ALTER TABLE access_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_secrets FORCE ROW LEVEL SECURITY;

ALTER TABLE access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_events FORCE ROW LEVEL SECURITY;

ALTER TABLE access_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_blocks FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON access_devices TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON access_secrets TO logifit_app;
GRANT SELECT, INSERT ON access_events TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON access_blocks TO logifit_app;

-- ─── access_devices ────────────────────────────────────────────────────
CREATE POLICY access_devices_tenant_select ON access_devices
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY access_devices_tenant_insert ON access_devices
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY access_devices_tenant_update ON access_devices
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── access_secrets ───────────────────────────────────────────────────
CREATE POLICY access_secrets_tenant_select ON access_secrets
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY access_secrets_tenant_insert ON access_secrets
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY access_secrets_tenant_update ON access_secrets
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── access_events (APPEND-ONLY) ──────────────────────────────────────
CREATE POLICY access_events_tenant_select ON access_events
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY access_events_tenant_insert ON access_events
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem UPDATE/DELETE.

-- ─── access_blocks ────────────────────────────────────────────────────
CREATE POLICY access_blocks_tenant_select ON access_blocks
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY access_blocks_tenant_insert ON access_blocks
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY access_blocks_tenant_update ON access_blocks
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
