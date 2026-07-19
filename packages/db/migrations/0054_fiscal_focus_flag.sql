-- packages/db/migrations/0054_fiscal_focus_flag.sql
-- Sprint 36b — seed feature flag `fiscal_focus_v1` (ADR 0059).
--
-- Flag disabled por default: habilitar por tenant só após credenciais Focus NFe
-- validadas em homologação (wizard /app/settings/fiscal) e 1 emissão de teste OK.
-- Gate nas SAs de emissão/eventos — leitura (listEmissions/getEmission) fica
-- livre pra inbox continuar visível.

INSERT INTO "feature_flags" ("key", "name", "description", "enabled") VALUES
  ('fiscal_focus_v1', 'Emissão fiscal via Focus NFe',
   'Habilita emissão real de NFS-e/NF-e/NFC-e + eventos (cancelamento/CC-e/inutilização) via provider Focus NFe (Sprint 36b, ADR 0059). Sem a flag, ações de emissão retornam FORBIDDEN.',
   false)
ON CONFLICT (key) DO NOTHING;

-- Permissions fiscal.* (gap do 36a — RLS policies 0054_fiscal_rls.sql referenciam
-- mas o catálogo nunca foi seedado; credenciais exigem fiscal.admin)
INSERT INTO "permissions" ("key", "label", "description", "category", "is_high_risk") VALUES
  ('fiscal.read',   'Ler emissões fiscais',      'Inbox /app/fiscal + detalhe + download PDF/XML',                    'fiscal', false),
  ('fiscal.emit',   'Emitir notas fiscais',      'Disparar emissão NFS-e/NF-e/NFC-e via provider',                    'fiscal', false),
  ('fiscal.cancel', 'Cancelar/corrigir emissões','Cancelamento, CC-e e inutilização (MFA recente — regra 43)',        'fiscal', true),
  ('fiscal.admin',  'Administrar config fiscal', 'Credenciais provider, catálogo de serviços, séries e numeração',    'fiscal', true)
ON CONFLICT (key) DO NOTHING;

-- Grants: tenant_owner + gerente operam o ciclo completo
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.key
FROM roles r
CROSS JOIN (VALUES ('fiscal.read'), ('fiscal.emit'), ('fiscal.cancel'), ('fiscal.admin'))
  AS p (key)
WHERE r.key IN ('tenant_owner', 'gerente')
ON CONFLICT DO NOTHING;

-- contador_externo: somente leitura (ADR 0061 — LGPD scope mínimo)
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, 'fiscal.read'
FROM roles r
WHERE r.key = 'contador_externo'
ON CONFLICT DO NOTHING;

-- super_admin: todas (CROSS JOIN do 0007 não cobre permissions pós-Sprint 01a)
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.key
FROM roles r
CROSS JOIN (VALUES ('fiscal.read'), ('fiscal.emit'), ('fiscal.cancel'), ('fiscal.admin'))
  AS p (key)
WHERE r.key = 'super_admin'
ON CONFLICT DO NOTHING;
