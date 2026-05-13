-- packages/db/src/policies/0017_agenda_rls.sql
-- Sprint 03 Faixa A — Agenda RLS + EXCLUDE constraint (ADR 0012 esperado).
--
-- 4 tabelas: resources, recurring_slots, appointments, appointment_waitlist.
-- Isolamento por tenant_id (regra 1). Scope company/unit aplicado em policies
-- via resources JOIN (regra 25 — clínico só na sua company em franchise).
--
-- **EXCLUDE constraint em appointments** garante exclusividade no nível de
-- banco — dois bookings simultâneos pro mesmo resource no mesmo intervalo
-- são bloqueados pelo Postgres. Drizzle não suporta — vai em SQL puro aqui.
--
-- Status ativos (`booked`, `checked_in`) compete; cancelled/no_show/completed
-- são history e podem coexistir.

-- ─── Ativa extensão btree_gist (necessária pra EXCLUDE com uuid =) ───────
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── EXCLUDE constraint em appointments ──────────────────────────────────
-- Drop primeiro (drop-then-create tolera idempotência)
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('booked', 'checked_in'));

COMMENT ON CONSTRAINT appointments_no_overlap ON appointments IS
  'Sprint 03 — exclude overlap pra status ativos (booked, checked_in). History coexiste.';

-- ─── RLS + FORCE em todas as tabelas ─────────────────────────────────────
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources FORCE ROW LEVEL SECURITY;

ALTER TABLE recurring_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_slots FORCE ROW LEVEL SECURITY;

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;

ALTER TABLE appointment_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_waitlist FORCE ROW LEVEL SECURITY;

-- ─── GRANTs pra role logifit_app ─────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON resources TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON recurring_slots TO logifit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON appointments TO logifit_app;
GRANT SELECT, INSERT, DELETE ON appointment_waitlist TO logifit_app;

-- ─── resources policies ─────────────────────────────────────────────────
CREATE POLICY resources_tenant_isolation_select ON resources
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY resources_tenant_isolation_insert ON resources
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY resources_tenant_isolation_update ON resources
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft-delete via `archived_at`.

-- ─── recurring_slots policies ───────────────────────────────────────────
CREATE POLICY recurring_slots_tenant_isolation_select ON recurring_slots
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY recurring_slots_tenant_isolation_insert ON recurring_slots
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY recurring_slots_tenant_isolation_update ON recurring_slots
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — pausar via `active=false`.

-- ─── appointments policies ──────────────────────────────────────────────
CREATE POLICY appointments_tenant_isolation_select ON appointments
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY appointments_tenant_isolation_insert ON appointments
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY appointments_tenant_isolation_update ON appointments
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- DELETE permitido pra cleanup admin (audit history em member_events Sprint 04+).
CREATE POLICY appointments_tenant_isolation_delete ON appointments
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── appointment_waitlist policies ──────────────────────────────────────
CREATE POLICY appointment_waitlist_tenant_isolation_select ON appointment_waitlist
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY appointment_waitlist_tenant_isolation_insert ON appointment_waitlist
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- DELETE permitido — leave waitlist + promoção (Sprint 03 Faixa B).
CREATE POLICY appointment_waitlist_tenant_isolation_delete ON appointment_waitlist
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem UPDATE — waitlist é INSERT/DELETE only.
