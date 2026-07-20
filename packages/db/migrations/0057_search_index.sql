-- packages/db/migrations/0057_search_index.sql
-- ADR 0062 fase 1 (débito #4 da auditoria 36b — Sprint 07 Faixa D fantasma).
-- Pesquisa global: tabela search_index + triggers sync (persons, members,
-- fiscal_emissions) + backfill. Palette consulta via GET /api/search.
-- @volume_estimate_yearly: 500000 (1 row por entidade indexada; regra 34 não aplica no MVP)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE TABLE "search_index" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "source_table" text NOT NULL,
  "source_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "subtitle" text,
  "url" text NOT NULL,
  "searchable_text" text NOT NULL,
  "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', searchable_text)) STORED,
  "required_permission" text,
  "required_vertical" text,
  "company_id" uuid,
  "is_sensitive" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "search_index_source_uq" ON "search_index" ("source_table", "source_id");
--> statement-breakpoint
CREATE INDEX "search_index_vector_idx" ON "search_index" USING gin ("search_vector");
--> statement-breakpoint
CREATE INDEX "search_index_trgm_idx" ON "search_index" USING gin ("searchable_text" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "search_index_tenant_kind_idx" ON "search_index" ("tenant_id", "kind");
--> statement-breakpoint
-- Upsert SECURITY DEFINER: triggers das tabelas-fonte escrevem no index sem
-- esbarrar na RLS do search_index (que é SELECT-only pra app).
CREATE OR REPLACE FUNCTION search_index_upsert(
  p_tenant_id uuid, p_source_table text, p_source_id uuid, p_kind text,
  p_label text, p_subtitle text, p_url text, p_searchable_text text,
  p_required_permission text, p_company_id uuid, p_is_sensitive boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO search_index (
    tenant_id, source_table, source_id, kind, label, subtitle, url,
    searchable_text, required_permission, company_id, is_sensitive, updated_at
  ) VALUES (
    p_tenant_id, p_source_table, p_source_id, p_kind, p_label, p_subtitle, p_url,
    left(coalesce(p_searchable_text, ''), 10000), p_required_permission, p_company_id,
    p_is_sensitive, now()
  )
  ON CONFLICT (source_table, source_id) DO UPDATE SET
    label = EXCLUDED.label,
    subtitle = EXCLUDED.subtitle,
    url = EXCLUDED.url,
    searchable_text = EXCLUDED.searchable_text,
    required_permission = EXCLUDED.required_permission,
    company_id = EXCLUDED.company_id,
    is_sensitive = EXCLUDED.is_sensitive,
    updated_at = now();
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION search_index_delete(p_source_table text, p_source_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM search_index WHERE source_table = p_source_table AND source_id = p_source_id;
END;
$$;
--> statement-breakpoint
-- ─── persons ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_index_sync_persons() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM search_index_delete('persons', OLD.id);
    RETURN OLD;
  END IF;
  PERFORM search_index_upsert(
    NEW.tenant_id, 'persons', NEW.id, 'person',
    coalesce(NEW.display_name, NEW.name),
    coalesce(NEW.document, NEW.email),
    '/app/pessoas/' || NEW.id,
    concat_ws(' ', NEW.name, NEW.display_name, NEW.document, NEW.email),
    NULL, NULL, false
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS search_index_sync_persons_trg ON persons;
--> statement-breakpoint
CREATE TRIGGER search_index_sync_persons_trg
  AFTER INSERT OR UPDATE OR DELETE ON persons
  FOR EACH ROW EXECUTE FUNCTION search_index_sync_persons();
--> statement-breakpoint
-- ─── members (label via persons no momento do write; rename de person
--     re-sincroniza quando o member for tocado — trade-off MVP) ──────────
CREATE OR REPLACE FUNCTION search_index_sync_members() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_name text;
  v_doc text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM search_index_delete('members', OLD.id);
    RETURN OLD;
  END IF;
  SELECT coalesce(p.display_name, p.name), p.document INTO v_name, v_doc
  FROM persons p WHERE p.id = NEW.person_id;
  PERFORM search_index_upsert(
    NEW.tenant_id, 'members', NEW.id, 'member',
    coalesce(v_name, 'Member'),
    v_doc,
    '/app/members/' || NEW.id,
    concat_ws(' ', v_name, v_doc),
    NULL, NULL, false
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS search_index_sync_members_trg ON members;
--> statement-breakpoint
CREATE TRIGGER search_index_sync_members_trg
  AFTER INSERT OR UPDATE OR DELETE ON members
  FOR EACH ROW EXECUTE FUNCTION search_index_sync_members();
--> statement-breakpoint
-- ─── fiscal_emissions (ADR 0062 tabela de expansão do Sprint 36) ───────
CREATE OR REPLACE FUNCTION search_index_sync_fiscal_emissions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_kind_label text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM search_index_delete('fiscal_emissions', OLD.id);
    RETURN OLD;
  END IF;
  v_kind_label := CASE NEW.kind
    WHEN 'nfse' THEN 'NFS-e' WHEN 'nfe' THEN 'NF-e' WHEN 'nfce' THEN 'NFC-e'
    WHEN 'nfe_return' THEN 'NF-e devolução' WHEN 'nfe_transfer' THEN 'NF-e transferência'
    WHEN 'nfe_conserto_out' THEN 'NF-e conserto (saída)'
    WHEN 'nfe_conserto_return' THEN 'NF-e conserto (retorno)'
    ELSE 'NF-e entrada própria' END;
  PERFORM search_index_upsert(
    NEW.tenant_id, 'fiscal_emissions', NEW.id, 'fiscal_emission',
    v_kind_label || ' ' || NEW.serie || '/' || NEW.numero,
    coalesce(NEW.recipient_name, '') || ' · ' || NEW.status,
    '/app/fiscal/' || NEW.id,
    concat_ws(' ', v_kind_label, NEW.serie || '/' || NEW.numero, NEW.numero::text,
              NEW.chave, NEW.recipient_name, NEW.recipient_document),
    'fiscal.read', NEW.company_id, false
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS search_index_sync_fiscal_emissions_trg ON fiscal_emissions;
--> statement-breakpoint
CREATE TRIGGER search_index_sync_fiscal_emissions_trg
  AFTER INSERT OR UPDATE OR DELETE ON fiscal_emissions
  FOR EACH ROW EXECUTE FUNCTION search_index_sync_fiscal_emissions();
--> statement-breakpoint
-- ─── Backfill ───────────────────────────────────────────────────────────
INSERT INTO search_index (tenant_id, source_table, source_id, kind, label, subtitle, url, searchable_text, required_permission, company_id, is_sensitive)
SELECT p.tenant_id, 'persons', p.id, 'person',
       coalesce(p.display_name, p.name), coalesce(p.document, p.email),
       '/app/pessoas/' || p.id,
       left(concat_ws(' ', p.name, p.display_name, p.document, p.email), 10000),
       NULL, NULL, false
FROM persons p
ON CONFLICT (source_table, source_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO search_index (tenant_id, source_table, source_id, kind, label, subtitle, url, searchable_text, required_permission, company_id, is_sensitive)
SELECT m.tenant_id, 'members', m.id, 'member',
       coalesce(p.display_name, p.name, 'Member'), p.document,
       '/app/members/' || m.id,
       left(concat_ws(' ', coalesce(p.display_name, p.name), p.document), 10000),
       NULL, NULL, false
FROM members m LEFT JOIN persons p ON p.id = m.person_id
ON CONFLICT (source_table, source_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO search_index (tenant_id, source_table, source_id, kind, label, subtitle, url, searchable_text, required_permission, company_id, is_sensitive)
SELECT e.tenant_id, 'fiscal_emissions', e.id, 'fiscal_emission',
       (CASE e.kind WHEN 'nfse' THEN 'NFS-e' WHEN 'nfe' THEN 'NF-e' WHEN 'nfce' THEN 'NFC-e'
         WHEN 'nfe_return' THEN 'NF-e devolução' WHEN 'nfe_transfer' THEN 'NF-e transferência'
         WHEN 'nfe_conserto_out' THEN 'NF-e conserto (saída)'
         WHEN 'nfe_conserto_return' THEN 'NF-e conserto (retorno)'
         ELSE 'NF-e entrada própria' END) || ' ' || e.serie || '/' || e.numero,
       coalesce(e.recipient_name, '') || ' · ' || e.status,
       '/app/fiscal/' || e.id,
       left(concat_ws(' ', e.numero::text, e.chave, e.recipient_name, e.recipient_document), 10000),
       'fiscal.read', e.company_id, false
FROM fiscal_emissions e
ON CONFLICT (source_table, source_id) DO NOTHING;
