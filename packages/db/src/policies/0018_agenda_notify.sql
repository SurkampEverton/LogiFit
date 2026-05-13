-- packages/db/src/policies/0018_agenda_notify.sql
-- Sprint 03 Faixa D — PG NOTIFY trigger pra agenda realtime (ADR 0012 + soberania perpétua #4).
--
-- Cada INSERT/UPDATE/DELETE em appointments emite NOTIFY no canal
-- `agenda:{tenant_id}`. Listener Next.js (SSE endpoint) faz LISTEN e
-- propaga via Server-Sent Events pros clients abertos.
--
-- Payload mínimo: { event, appointment_id, tenant_id, resource_id, member_id }.
-- Cliente revalida via `router.refresh()` em vez de mergear delta direto —
-- evita complexidade de cliente sync e ROI da otimização é baixa MVP.

CREATE OR REPLACE FUNCTION agenda_notify_change()
RETURNS trigger AS $$
DECLARE
  v_payload jsonb;
  v_tenant uuid;
  v_event text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id;
    v_event := 'appointment.deleted';
    v_payload := jsonb_build_object(
      'event', v_event,
      'appointment_id', OLD.id,
      'tenant_id', OLD.tenant_id,
      'resource_id', OLD.resource_id,
      'member_id', OLD.member_id
    );
  ELSE
    v_tenant := NEW.tenant_id;
    v_event := CASE TG_OP
      WHEN 'INSERT' THEN 'appointment.created'
      WHEN 'UPDATE' THEN
        CASE
          WHEN OLD.status != NEW.status THEN 'appointment.status_changed'
          ELSE 'appointment.updated'
        END
    END;
    v_payload := jsonb_build_object(
      'event', v_event,
      'appointment_id', NEW.id,
      'tenant_id', NEW.tenant_id,
      'resource_id', NEW.resource_id,
      'member_id', NEW.member_id,
      'status', NEW.status,
      'starts_at', NEW.starts_at
    );
  END IF;

  -- Channel name `agenda:{tenant_id}` — listener faz LISTEN no mesmo nome
  PERFORM pg_notify('agenda:' || v_tenant::text, v_payload::text);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION agenda_notify_change() IS
  'Sprint 03 Faixa D — emite pg_notify(agenda:{tenant_id}) em CRUD appointments.';

-- Triggers AFTER (não interfere em RLS/EXCLUDE check)
DROP TRIGGER IF EXISTS agenda_notify_insert ON appointments;
DROP TRIGGER IF EXISTS agenda_notify_update ON appointments;
DROP TRIGGER IF EXISTS agenda_notify_delete ON appointments;

CREATE TRIGGER agenda_notify_insert
  AFTER INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION agenda_notify_change();

CREATE TRIGGER agenda_notify_update
  AFTER UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION agenda_notify_change();

CREATE TRIGGER agenda_notify_delete
  AFTER DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION agenda_notify_change();
