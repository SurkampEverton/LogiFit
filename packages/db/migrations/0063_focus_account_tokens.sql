-- 0063 — Dois níveis de token Focus NFe: conta (cadastro) e empresa (emissão).
--
-- A Focus separa dois escopos que estávamos tratando como um só:
--   • token de CONTA   → gerencia `/v2/empresas` (criar empresa, credenciais do
--                        portal municipal, inscrição municipal, série do RPS)
--   • token de EMPRESA → emite documentos daquela empresa (é o que já existia em
--                        `fiscal_provider_credentials.api_token_*`)
--
-- Usar o token de emissão para gerenciar cadastro devolve 403 — foi o erro que
-- apareceu no primeiro uso real da tela de credenciais municipais (2026-07-20).
--
-- Dois arranjos possíveis, e o flag `own_account` decide por tenant sem
-- comprometer o modelo comercial (ADR 0105):
--   • own_account = false (default) → usa o token de conta da PLATAFORMA
--     (`fiscal_platform_credentials`): a LogiFit hospeda as empresas na conta
--     dela e o tenant nunca vê o painel da Focus.
--   • own_account = true            → o tenant tem conta própria na Focus e
--     informa o próprio token de conta, guardado cifrado junto com o de emissão.
--
-- @volume_estimate_yearly: 0 (singleton + colunas em tabela existente)

-- ─── Nível conta: credencial da plataforma (global, sem tenant) ───────────
-- Exceção consciente à regra 1 (toda tabela tem tenant_id + RLS): esta linha é
-- da LogiFit, não de um tenant — mesmo precedente de `ai_providers`/`ai_models`.
-- A RLS abaixo NEGA leitura a qualquer contexto de tenant; só `app.role='system'`
-- (server-side, após gate de super_admin na Server Action) enxerga.
CREATE TABLE IF NOT EXISTS fiscal_platform_credentials (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                text NOT NULL DEFAULT 'focus_nfe',
  environment             text NOT NULL DEFAULT 'producao',
  account_token_encrypted text NOT NULL,
  account_token_nonce     text NOT NULL,
  account_token_tag       text NOT NULL,
  last_validated_at       timestamptz,
  last_validation_status  text,
  updated_by_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_platform_credentials_provider_valid
    CHECK (provider IN ('focus_nfe', 'nfse_nacional', 'enotas')),
  CONSTRAINT fiscal_platform_credentials_env_valid
    CHECK (environment IN ('homologacao', 'producao'))
);

-- Singleton por provider: existe uma conta LogiFit por provider, não N.
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_platform_credentials_provider_uq
  ON fiscal_platform_credentials (provider);

ALTER TABLE fiscal_platform_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_platform_credentials FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON fiscal_platform_credentials TO logifit_app;

-- Sem policy por tenant: contexto de tenant NUNCA lê o segredo da plataforma.
CREATE POLICY fiscal_platform_credentials_system_all ON fiscal_platform_credentials
  FOR ALL
  USING (current_setting('app.role', true) = 'system')
  WITH CHECK (current_setting('app.role', true) = 'system');

COMMENT ON TABLE fiscal_platform_credentials IS
  'Token de CONTA Focus NFe da LogiFit (gerencia /v2/empresas). Global por design — não tem tenant_id. Só app.role=system lê.';

-- ─── Nível tenant: flag de cadastro próprio + token de conta opcional ─────
ALTER TABLE fiscal_provider_credentials
  ADD COLUMN IF NOT EXISTS own_account boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_token_encrypted text,
  ADD COLUMN IF NOT EXISTS account_token_nonce text,
  ADD COLUMN IF NOT EXISTS account_token_tag text;

-- Ligar o flag sem informar o token deixaria o tenant sem caminho de cadastro:
-- falha no banco em vez de falhar na Focus com 403 confuso.
ALTER TABLE fiscal_provider_credentials
  DROP CONSTRAINT IF EXISTS fiscal_provider_credentials_own_account_token;
ALTER TABLE fiscal_provider_credentials
  ADD CONSTRAINT fiscal_provider_credentials_own_account_token
  CHECK (own_account = false OR account_token_encrypted IS NOT NULL);

COMMENT ON COLUMN fiscal_provider_credentials.own_account IS
  'true = tenant tem conta propria na Focus e informa o proprio token de conta; false = usa a conta da plataforma (fiscal_platform_credentials).';
COMMENT ON COLUMN fiscal_provider_credentials.account_token_encrypted IS
  'Token de CONTA do tenant (gerencia /v2/empresas). Distinto de api_token_*, que e o token de EMISSAO da empresa.';
