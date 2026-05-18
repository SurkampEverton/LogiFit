-- packages/db/src/policies/0054_fiscal_rls.sql
-- Sprint 36 Faixa A — Fiscal Emissions backbone (ADR 0059 Accepted).
--
-- 5 tabelas:
--   - fiscal_emissions: tenant + permissions fiscal.read/emit/cancel/admin
--   - fiscal_events: tenant; permission fiscal.cancel pra cancellation/cce/inutilizacao
--   - fiscal_numbering_sequences: tenant + admin-only write
--   - fiscal_service_catalog: tenant + permissions fiscal.admin
--   - fiscal_provider_credentials: tenant + fiscal.admin EXCLUSIVO (token cifrado mas RLS extra)

ALTER TABLE fiscal_emissions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_emissions             FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal_events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_events                FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal_numbering_sequences   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_numbering_sequences   FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal_service_catalog       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_service_catalog       FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal_provider_credentials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_provider_credentials  FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON fiscal_emissions             TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON fiscal_events                TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON fiscal_numbering_sequences   TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON fiscal_service_catalog       TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON fiscal_provider_credentials  TO logifit_app;

-- ─── fiscal_emissions ──────────────────────────────────────────────────
CREATE POLICY fiscal_emissions_select ON fiscal_emissions
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      -- staff com fiscal.read
      current_setting('app.permissions', true) LIKE '%fiscal.read%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.emit%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      -- contador externo (ADR 0061) read-only
      OR current_setting('app.role', true) = 'contador_externo'
    )
  );

CREATE POLICY fiscal_emissions_insert ON fiscal_emissions
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.emit%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
    )
  );

CREATE POLICY fiscal_emissions_update ON fiscal_emissions
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.emit%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.cancel%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      -- webhook callback usa app role 'system' (sem permission individual)
      OR current_setting('app.role', true) = 'system'
    )
  )
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── fiscal_events ─────────────────────────────────────────────────────
CREATE POLICY fiscal_events_select ON fiscal_events
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.read%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.cancel%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) = 'contador_externo'
    )
  );

CREATE POLICY fiscal_events_insert ON fiscal_events
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.cancel%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
    )
  );

CREATE POLICY fiscal_events_update ON fiscal_events
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.cancel%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) = 'system'
    )
  )
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── fiscal_numbering_sequences ────────────────────────────────────────
CREATE POLICY fiscal_numbering_select ON fiscal_numbering_sequences
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.read%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.emit%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
    )
  );

CREATE POLICY fiscal_numbering_insert ON fiscal_numbering_sequences
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND current_setting('app.permissions', true) LIKE '%fiscal.admin%'
  );

CREATE POLICY fiscal_numbering_update ON fiscal_numbering_sequences
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      -- emit pode incrementar nextNumero atomicamente
      current_setting('app.permissions', true) LIKE '%fiscal.emit%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
    )
  )
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── fiscal_service_catalog ────────────────────────────────────────────
CREATE POLICY fiscal_service_catalog_select ON fiscal_service_catalog
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.read%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.emit%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
    )
  );

CREATE POLICY fiscal_service_catalog_insert ON fiscal_service_catalog
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND current_setting('app.permissions', true) LIKE '%fiscal.admin%'
  );

CREATE POLICY fiscal_service_catalog_update ON fiscal_service_catalog
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND current_setting('app.permissions', true) LIKE '%fiscal.admin%'
  )
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── fiscal_provider_credentials ───────────────────────────────────────
-- Token cifrado AES-256-GCM (ADR 0073 camada 4); RLS extra: SOMENTE fiscal.admin
-- ou role system (decrypt no servidor durante chamada safeFetch)
CREATE POLICY fiscal_provider_credentials_select ON fiscal_provider_credentials
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) = 'system'
    )
  );

CREATE POLICY fiscal_provider_credentials_insert ON fiscal_provider_credentials
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND current_setting('app.permissions', true) LIKE '%fiscal.admin%'
  );

CREATE POLICY fiscal_provider_credentials_update ON fiscal_provider_credentials
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      -- job de validação background usa role system pra atualizar last_validated_at
      OR current_setting('app.role', true) = 'system'
    )
  )
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE fiscal_emissions IS
  'Sprint 36 — emissão NFS-e/NF-e/NFC-e/devolução/transferência/conserto via Focus NFe (ADR 0059). Status workflow draft→queued→processing→completed|rejected|cancelled. Cobrança via overage ADR 0066 (status=completed conta).';
COMMENT ON TABLE fiscal_events IS
  'Sprint 36 — eventos pós-emissão (cancelamento/CC-e/inutilização). Append-only — não sobrescreve emission. Eventos NÃO contam no overage.';
COMMENT ON TABLE fiscal_numbering_sequences IS
  'Sprint 36 — numeração atomicamente incrementada via UPDATE...RETURNING. Gap detection Sprint 36b dispara sugestão de inutilização.';
COMMENT ON TABLE fiscal_service_catalog IS
  'Sprint 36 — catálogo serviços tributáveis (LC 116/2003 + ISS + retenções) por (tenant, company). NFS-e consome no payload.';
COMMENT ON TABLE fiscal_provider_credentials IS
  'Sprint 36 — credentials provider (Focus NFe) cifradas AES-256-GCM via KEK por tenant (ADR 0073). RLS extra fiscal.admin-only.';
