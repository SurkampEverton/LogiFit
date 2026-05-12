-- packages/db/src/policies/0003_cnpj_cache_rls.sql
-- Sprint 01a Faixa A — RLS de cnpj_cache + tenant_cnpj_settings (ADR 0048).

-- ─── cnpj_cache ──────────────────────────────────────────────────────────
-- Cache GLOBAL — leitura livre pra qualquer user autenticado.
-- Escrita: só via Server Action server-side (que roda com BYPASSRLS=true
-- ou via função SECURITY DEFINER chamada após lookup). Negar INSERT/UPDATE
-- na policy garante que nenhum cliente direto consegue poluir o cache.
ALTER TABLE cnpj_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE cnpj_cache FORCE  ROW LEVEL SECURITY;

-- SELECT livre (qualquer tenant autenticado lê o cache global)
CREATE POLICY cnpj_cache_public_read ON cnpj_cache
  FOR SELECT
  USING (current_setting('app.user_id', true) IS NOT NULL
         AND current_setting('app.user_id', true) <> '');

-- Sem policy de INSERT/UPDATE/DELETE → DENY por padrão (FORCE RLS).
-- Server Action que faz lookup CNPJ usa connection com BYPASSRLS=true ou
-- chama função SECURITY DEFINER (criada na Faixa D — provider de CNPJ).

-- ─── tenant_cnpj_settings ────────────────────────────────────────────────
-- Settings por tenant — só lê/escreve quem é do tenant.
ALTER TABLE tenant_cnpj_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_cnpj_settings FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_cnpj_settings_self_select ON tenant_cnpj_settings
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_cnpj_settings_self_insert ON tenant_cnpj_settings
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_cnpj_settings_self_update ON tenant_cnpj_settings
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE cnpj_cache IS
  'Cache global Receita Federal (ADR 0048). SELECT livre p/ autenticados; INSERT/UPDATE só via Server Action.';
COMMENT ON TABLE tenant_cnpj_settings IS
  'Configuração de provider CNPJ por tenant (BrasilAPI default + ReceitaWS fallback + CNPJá! opcional).';
