-- packages/db/migrations/0053_fiscal_apuracao_permissions.sql
-- Sprint 37b — permissions canônicas fiscal.apuracao.* (ADR 0019 + 0100).
--
-- Adiciona 3 permissions ao catálogo + grants pras roles canônicas:
--   - tenant_owner / gerente: read + write + close
--   - contador_externo: read (somente leitura conforme ADR 0061)
--   - super_admin: tudo via JOIN existente em 0007_rbac_seed.sql (idempotente)
--
-- Idempotente — ON CONFLICT DO NOTHING.

INSERT INTO "permissions" ("key", "label", "description", "category", "is_high_risk") VALUES
  ('fiscal.apuracao.read',  'Ler apuração fiscal',     'Listar e visualizar apurações Sprint 37',                          'fiscal', false),
  ('fiscal.apuracao.write', 'Calcular apuração fiscal', 'Disparar aggregateMonthlyRevenue + regenerar enquanto draft',     'fiscal', false),
  ('fiscal.apuracao.close', 'Fechar apuração',          'Marcar status=closed; ação irreversível (Sprint 37c+ reabre)',    'fiscal', true)
ON CONFLICT (key) DO NOTHING;

-- Grants pras roles canônicas
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.key
FROM roles r
CROSS JOIN (VALUES
  ('fiscal.apuracao.read'),
  ('fiscal.apuracao.write'),
  ('fiscal.apuracao.close')
) AS p (key)
WHERE r.key IN ('tenant_owner', 'gerente')
ON CONFLICT DO NOTHING;

-- contador_externo: somente leitura
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, 'fiscal.apuracao.read'
FROM roles r
WHERE r.key = 'contador_externo'
ON CONFLICT DO NOTHING;

-- super_admin já recebeu todas as permissions via CROSS JOIN no 0007_rbac_seed.sql;
-- novas permissions seedadas neste arquivo precisam de adicionar manualmente
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r.id, p.key
FROM roles r
CROSS JOIN (VALUES
  ('fiscal.apuracao.read'),
  ('fiscal.apuracao.write'),
  ('fiscal.apuracao.close')
) AS p (key)
WHERE r.key = 'super_admin'
ON CONFLICT DO NOTHING;
