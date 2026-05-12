-- packages/db/src/policies/0014_members_rls.sql
-- Sprint 02 Faixa A — RLS pras 4 tabelas members (regras 1, 25, 42).
--
-- **Scope simplificado MVP**: RLS por tenant_id apenas. Sprint 02 ainda não
-- diferencia scope_company_id no policy SQL — Server Actions verificam via
-- `has_permission(user_id, 'member.read', 'company', company_id)` (ADR 0019).
--
-- **Regra 25 (franchise)**: clínico não cruza company. Verificada em
-- Server Actions via has_permission(); RLS pura limita ao tenant. Sprint
-- 11+ (prescrições/evolução) adiciona policies condicionais por scope.

-- ─── members ─────────────────────────────────────────────────────────────
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE members FORCE  ROW LEVEL SECURITY;

CREATE POLICY members_tenant_select ON members
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY members_tenant_insert ON members
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY members_tenant_update ON members
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft-delete via `archived_at` (regra 5)

-- ─── member_events (append-only — regra 5) ──────────────────────────────
ALTER TABLE member_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_events FORCE  ROW LEVEL SECURITY;

CREATE POLICY member_events_tenant_select ON member_events
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY member_events_tenant_insert ON member_events
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem UPDATE/DELETE — append-only enforced via ausência de policy

-- ─── member_notes ────────────────────────────────────────────────────────
ALTER TABLE member_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_notes FORCE  ROW LEVEL SECURITY;

CREATE POLICY member_notes_tenant_select ON member_notes
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY member_notes_tenant_insert ON member_notes
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY member_notes_tenant_update ON member_notes
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY member_notes_tenant_delete ON member_notes
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── member_tags ────────────────────────────────────────────────────────
ALTER TABLE member_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_tags FORCE  ROW LEVEL SECURITY;

CREATE POLICY member_tags_tenant_select ON member_tags
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY member_tags_tenant_insert ON member_tags
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY member_tags_tenant_delete ON member_tags
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE members IS
  'ADR 0011 — perfil único cross-module. person_id FK (ADR 0047). Soft-delete via archived_at.';
COMMENT ON TABLE member_events IS
  'Timeline append-only (regra 5). Particionamento Sprint 04+.';
COMMENT ON TABLE member_notes IS
  'Notes Nível 5 — nunca cruza tenant (regra 42). Sprint 02 addNote tem // ai-blocked (regra 41).';
COMMENT ON TABLE member_tags IS
  'Tags livres por tenant. PK composta (tenant_id, member_id, tag).';
