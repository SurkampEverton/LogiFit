-- packages/db/src/policies/0035_rateio_ic_rls.sql
-- Sprint 16 Faixa A — Rateio + Intercompany RLS (ADR 0036).
--
-- 3 tabelas: allocation_rules + ap_allocations + intercompany_entries
--
-- **Regra 25 (franchise bloqueia)** enforced via trigger BEFORE INSERT que
-- consulta `tenants.topology`. Se != 'owned', rejeita. `ap_allocations` herda
-- via AP-pai (regra de plataforma — não cria trigger separado).
--
-- **`ap_allocations` append-only** — sem UPDATE/DELETE policy. Correção via
-- cancelar AP-pai e recriar.
--
-- **`intercompany_entries` UPDATE permitido** apenas para liquidação
-- (settled_at/settlement_method/counter_entry_id) — trigger Sprint 16+
-- validate apenas colunas de liquidação alteradas.

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE allocation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE ap_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap_allocations FORCE ROW LEVEL SECURITY;

ALTER TABLE intercompany_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercompany_entries FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON allocation_rules TO logifit_app;
GRANT SELECT, INSERT ON ap_allocations TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON intercompany_entries TO logifit_app;

-- ─── allocation_rules ──────────────────────────────────────────────────
CREATE POLICY allocation_rules_tenant_select ON allocation_rules
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY allocation_rules_tenant_insert ON allocation_rules
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY allocation_rules_tenant_update ON allocation_rules
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── ap_allocations (append-only) ──────────────────────────────────────
CREATE POLICY ap_allocations_tenant_select ON ap_allocations
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ap_allocations_tenant_insert ON ap_allocations
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem UPDATE/DELETE — correção via cancelar AP-pai.

-- ─── intercompany_entries ──────────────────────────────────────────────
CREATE POLICY ic_entries_tenant_select ON intercompany_entries
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ic_entries_tenant_insert ON intercompany_entries
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ic_entries_tenant_update ON intercompany_entries
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── Triggers de regra 25 (franchise bloqueia) ─────────────────────────
CREATE OR REPLACE FUNCTION enforce_owned_topology_for_allocation()
RETURNS TRIGGER AS $$
DECLARE
  v_topology text;
BEGIN
  SELECT topology::text INTO v_topology FROM tenants WHERE id = NEW.tenant_id;
  IF v_topology IS DISTINCT FROM 'owned' THEN
    RAISE EXCEPTION 'allocation_rules requer tenant.topology=owned (regra 25); atual=%', v_topology
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_allocation_rules_owned_only ON allocation_rules;
CREATE TRIGGER trg_allocation_rules_owned_only
BEFORE INSERT ON allocation_rules
FOR EACH ROW EXECUTE FUNCTION enforce_owned_topology_for_allocation();

CREATE OR REPLACE FUNCTION enforce_owned_topology_for_ic()
RETURNS TRIGGER AS $$
DECLARE
  v_topology text;
BEGIN
  SELECT topology::text INTO v_topology FROM tenants WHERE id = NEW.tenant_id;
  IF v_topology IS DISTINCT FROM 'owned' THEN
    RAISE EXCEPTION 'intercompany_entries requer tenant.topology=owned (regra 25); atual=%', v_topology
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ic_entries_owned_only ON intercompany_entries;
CREATE TRIGGER trg_ic_entries_owned_only
BEFORE INSERT ON intercompany_entries
FOR EACH ROW EXECUTE FUNCTION enforce_owned_topology_for_ic();

-- ─── Trigger requires_nfe_transfer (kind='goods' + CNPJs distintos) ────
CREATE OR REPLACE FUNCTION compute_requires_nfe_transfer()
RETURNS TRIGGER AS $$
DECLARE
  v_from_person uuid;
  v_to_person uuid;
BEGIN
  IF NEW.kind = 'goods' THEN
    SELECT person_id INTO v_from_person FROM companies WHERE id = NEW.from_company_id;
    SELECT person_id INTO v_to_person FROM companies WHERE id = NEW.to_company_id;
    IF v_from_person IS DISTINCT FROM v_to_person THEN
      NEW.requires_nfe_transfer := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ic_entries_nfe_transfer_flag ON intercompany_entries;
CREATE TRIGGER trg_ic_entries_nfe_transfer_flag
BEFORE INSERT ON intercompany_entries
FOR EACH ROW EXECUTE FUNCTION compute_requires_nfe_transfer();

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE allocation_rules IS
  'ADR 0036 — DSL declarativa de rateio (fixed/proportional/per_unit/by_revenue/by_headcount/custom). Regra 25 enforced: tenant.topology=owned obrigatório.';
COMMENT ON TABLE ap_allocations IS
  'ADR 0036 — entries de rateio gerados ao submeter AP com allocation_rule_id. Append-only via ausência de UPDATE/DELETE policy.';
COMMENT ON TABLE intercompany_entries IS
  'ADR 0036 — lançamento espelhado entre 2 companies (counter_entry_id). Trigger marca requires_nfe_transfer=true quando kind=goods + CNPJs distintos (Sprint 36 emite via Focus NFe ADR 0059).';
