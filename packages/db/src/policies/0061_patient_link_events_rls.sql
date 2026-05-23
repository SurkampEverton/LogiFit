-- packages/db/src/policies/0061_patient_link_events_rls.sql
-- Sprint 02c.4 — RLS pra patient_link_events (regra 5 + ADR 0077).
--
-- Tabela parent + partições herdam policies automaticamente.
-- Append-only: INSERT permitido com tenant_id = app.tenant_id; SELECT só do
-- próprio tenant; UPDATE/DELETE DENY total (sem policy → bloqueado por FORCE).

ALTER TABLE patient_link_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_link_events FORCE  ROW LEVEL SECURITY;

-- SELECT: tenant atual vê seus próprios eventos
CREATE POLICY patient_link_events_select ON patient_link_events
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- INSERT: helper logPatientLinkEvent passa tenant_id = current_setting
CREATE POLICY patient_link_events_insert ON patient_link_events
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- UPDATE/DELETE: sem policy = bloqueado por FORCE (append-only)
-- Regra 5 reforçada via GRANTs explícitos.
GRANT SELECT, INSERT ON patient_link_events TO logifit_app;
REVOKE UPDATE, DELETE ON patient_link_events FROM logifit_app;
