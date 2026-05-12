-- packages/db/src/policies/0008_audit_rls.sql
-- Sprint 01a Faixa F — RLS pra audit_log + system_alerts (regras 5, 39 + ADR 0071).
--
-- Padrão:
--   - audit_log: SELECT por tenant; INSERT permitido (qualquer escrita via
--     wrapAction); UPDATE/DELETE bloqueados em todos os roles (regra 5
--     append-only). Trigger BEFORE INSERT computa hash chain.
--   - system_alerts: SELECT por tenant + role >= min_role; INSERT/UPDATE
--     via Server Actions admin; soft-resolve via UPDATE acknowledged_at.
--   - system_alert_occurrences: cascata de system_alerts (RLS via subquery).

-- ─── audit_log ───────────────────────────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE  ROW LEVEL SECURITY;

CREATE POLICY audit_log_tenant_select ON audit_log
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY audit_log_tenant_insert ON audit_log
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem policy de UPDATE/DELETE → DENY total (regra 5 — append-only).

-- ─── audit_log hash chain trigger (regra 39) ─────────────────────────────
-- Cada row computa:
--   current_hash = encode(sha256(id || tenant_id || at || actor_user_id ||
--                                action || coalesce(payload::text, '') ||
--                                coalesce(previous_hash, '')), 'hex')
--
-- previous_hash vem da última linha do MESMO tenant_id, lockada com FOR UPDATE
-- pra serializar inserts concorrentes (sem isso, 2 INSERTs paralelos pegariam
-- mesmo previous_hash → chain quebra).

CREATE OR REPLACE FUNCTION audit_log_hash_chain_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_prev_hash text;
BEGIN
  -- SECURITY DEFINER (definido abaixo) — bypass RLS + privilege check pro
  -- SELECT FOR UPDATE funcionar mesmo com role logifit_app (que NÃO tem
  -- UPDATE em audit_log por defesa em profundidade — regra 5 append-only).
  SELECT current_hash INTO v_prev_hash
  FROM audit_log
  WHERE tenant_id = NEW.tenant_id
  ORDER BY at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  NEW.previous_hash := v_prev_hash;
  NEW.current_hash := encode(
    digest(
      NEW.id::text
      || '|' || NEW.tenant_id::text
      || '|' || to_char(NEW.at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF')
      || '|' || coalesce(NEW.actor_user_id::text, '')
      || '|' || NEW.action
      || '|' || coalesce(NEW.payload::text, '')
      || '|' || coalesce(NEW.previous_hash, ''),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Owner é postgres (superuser) — SECURITY DEFINER faz a função rodar com
-- privilégio dele, bypassando RLS quando necessário. NÃO há injection
-- risk: função não aceita input dinâmico SQL (apenas NEW.*).

DROP TRIGGER IF EXISTS trg_audit_log_hash_chain ON audit_log;
CREATE TRIGGER trg_audit_log_hash_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_hash_chain_trigger();

COMMENT ON FUNCTION audit_log_hash_chain_trigger() IS
  'Regra 39: hash chain. Job verify-audit-integrity (semanal) detecta quebra → system_alerts critical.';

-- ─── system_alerts ───────────────────────────────────────────────────────
ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_alerts FORCE  ROW LEVEL SECURITY;

CREATE POLICY system_alerts_tenant_select ON system_alerts
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY system_alerts_tenant_insert ON system_alerts
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY system_alerts_tenant_update ON system_alerts
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── system_alert_occurrences ─────────────────────────────────────────────
ALTER TABLE system_alert_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_alert_occurrences FORCE  ROW LEVEL SECURITY;

CREATE POLICY system_alert_occurrences_via_alert ON system_alert_occurrences
  FOR ALL
  USING (
    alert_id IN (
      SELECT id FROM system_alerts
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  )
  WITH CHECK (
    alert_id IN (
      SELECT id FROM system_alerts
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

COMMENT ON TABLE audit_log IS
  'Append-only (regra 5). Hash chain (regra 39). Retenção 5 anos. Particionamento Sprint 04+ (regra 34).';
COMMENT ON TABLE system_alerts IS
  'Alertas críticos (ADR 0071). Fingerprint dedup + ring buffer 20 ocorrências em system_alert_occurrences.';
