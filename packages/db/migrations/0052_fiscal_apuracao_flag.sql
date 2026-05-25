-- packages/db/migrations/0052_fiscal_apuracao_flag.sql
-- Sprint 37b — seed feature flag `fiscal_apuracao_v1` (ADR 0098).
--
-- Flag disabled por default (operador habilita após validar 3 cálculos canônicos
-- com contador). Gate em /app/fiscal/apuracao + actions wrapServerAction.

INSERT INTO "feature_flags" ("key", "name", "description", "enabled") VALUES
  ('fiscal_apuracao_v1', 'Apuração fiscal mensal',
   'Habilita /app/fiscal/apuracao + 5 SAs aggregate/get/list/regenerate/close (Sprint 37a/b, ADR 0100). Cálculo Simples/Presumido/Real/MEI com memorial estruturado. Sprint 38 emite guias oficiais.',
   false)
ON CONFLICT (key) DO NOTHING;
