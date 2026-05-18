-- packages/db/src/policies/0050_devices_rls.sql
-- Sprint 32 Faixa A — Device Hub v1.
--
-- 7 tabelas:
--   - device_connections: member portal + staff scope
--   - device_readings: dado biométrico (regra 4 LGPD art. 11)
--   - device_readings_daily_summary: agregado (mesmo scope)
--   - device_readings_curated: leituras validadas pelo profissional
--   - device_sync_cursors: só staff/job (member não tem motivo de ver)
--   - device_consents: member portal vê próprios + staff scope
--   - device_incidents: staff scope (audit; member não tem o que fazer)
--
-- Dado clínico (regra 25 + LGPD art. 11). Member portal Sprint 26 via
-- app.member_id.

ALTER TABLE device_connections             ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_connections             FORCE ROW LEVEL SECURITY;
ALTER TABLE device_readings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_readings                FORCE ROW LEVEL SECURITY;
ALTER TABLE device_readings_daily_summary  ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_readings_daily_summary  FORCE ROW LEVEL SECURITY;
ALTER TABLE device_readings_curated        ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_readings_curated        FORCE ROW LEVEL SECURITY;
ALTER TABLE device_sync_cursors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sync_cursors            FORCE ROW LEVEL SECURITY;
ALTER TABLE device_consents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_consents                FORCE ROW LEVEL SECURITY;
ALTER TABLE device_incidents               ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_incidents               FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON device_connections            TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON device_readings               TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON device_readings_daily_summary TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON device_readings_curated       TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON device_sync_cursors           TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON device_consents               TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON device_incidents              TO logifit_app;

-- ─── device_connections ─────────────────────────────────────────────────
CREATE POLICY dev_conn_select ON device_connections
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY dev_conn_insert ON device_connections
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY dev_conn_update ON device_connections
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

-- ─── device_readings ────────────────────────────────────────────────────
CREATE POLICY dev_readings_select ON device_readings
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY dev_readings_insert ON device_readings
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY dev_readings_update ON device_readings
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── device_readings_daily_summary ──────────────────────────────────────
CREATE POLICY dev_summary_select ON device_readings_daily_summary
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY dev_summary_insert ON device_readings_daily_summary
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY dev_summary_update ON device_readings_daily_summary
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── device_readings_curated ────────────────────────────────────────────
CREATE POLICY dev_curated_select ON device_readings_curated
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY dev_curated_insert ON device_readings_curated
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── device_sync_cursors ────────────────────────────────────────────────
-- Apenas staff/job; member não interage
CREATE POLICY dev_sync_cursor_select ON device_sync_cursors
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM device_connections dc
      WHERE dc.id = device_sync_cursors.connection_id
        AND dc.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY dev_sync_cursor_upsert ON device_sync_cursors
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM device_connections dc
      WHERE dc.id = device_sync_cursors.connection_id
        AND dc.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY dev_sync_cursor_update ON device_sync_cursors
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM device_connections dc
      WHERE dc.id = device_sync_cursors.connection_id
        AND dc.tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- ─── device_consents ────────────────────────────────────────────────────
CREATE POLICY dev_consents_select ON device_consents
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY dev_consents_insert ON device_consents
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY dev_consents_update ON device_consents
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

-- ─── device_incidents (staff scope; member não vê audit) ────────────────
CREATE POLICY dev_incidents_select ON device_incidents
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY dev_incidents_insert ON device_incidents
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY dev_incidents_update ON device_incidents
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE device_connections IS
  'Sprint 32 — Device Hub v1: conexões OAuth/BLE por (member, provider). Tokens criptografados Sprint 32b (envelope encryption ADR 0073). ADR 0049.';
COMMENT ON TABLE device_readings IS
  'Sprint 32 — leituras brutas FHIR-like Observation. Particionamento diário Sprint 32b (regra 34 + ADR 0072). Retenção raw 90d. @volume 180M+/ano.';
COMMENT ON TABLE device_readings_curated IS
  'Sprint 32 — leituras curadas pelo profissional (Uso 1 ADR 0049). Snapshot da leitura bruta no momento da validação — sobrevive ao drop diário. Referenciada por assessment_measurements.source_device_reading_id.';
