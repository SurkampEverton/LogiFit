-- packages/db/src/policies/0040_evolucoes_rls.sql
-- Sprint 21 Faixa A — Evolução por sessão Fisio + anexos RLS.
--
-- 2 tabelas: evolucoes_sessao + evolucao_attachments
--
-- **Volume top-5 MVP** — `evolucoes_sessao` particionamento manual migration
-- futura (regra 34 + ADR 0072). RLS aplicada na tabela pai antes do PARTITION BY.
--
-- **Regra 25 (franchise)** — dado clínico não cruza company. RLS pura limita
-- ao tenant; Server Action faz filtragem fina por company quando topology=franchise.

ALTER TABLE evolucoes_sessao ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolucoes_sessao FORCE ROW LEVEL SECURITY;

ALTER TABLE evolucao_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolucao_attachments FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON evolucoes_sessao TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON evolucao_attachments TO logifit_app;

-- ─── evolucoes_sessao ──────────────────────────────────────────────────
CREATE POLICY evol_tenant_select ON evolucoes_sessao
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY evol_tenant_insert ON evolucoes_sessao
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY evol_tenant_update ON evolucoes_sessao
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── evolucao_attachments ─────────────────────────────────────────────
CREATE POLICY evol_att_tenant_select ON evolucao_attachments
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY evol_att_tenant_insert ON evolucao_attachments
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- UPDATE permitido pra mudar scan_status (pending → clean/rejected) e soft_delete
CREATE POLICY evol_att_tenant_update ON evolucao_attachments
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE evolucoes_sessao IS
  'Sprint 21 — evolução por sessão fisio (SOAP enxuto, mobile-friendly). Retenção 20a (Lei 13.787 + COFFITO 415). @volume 52M+/ano particionamento por trimestre manual.';
COMMENT ON TABLE evolucao_attachments IS
  'Sprint 21 — anexos categorizados em MinIO bucket fisio-evolucoes. scanUpload obrigatório (regra 38) antes de scan_status=clean. Soft-delete preserva metadata pra audit.';
