-- packages/db/init/0001_roles.sql
-- Sprint 01a Faixa A — roles canônicos do banco.
--
-- Postgres `superuser` bypassa RLS por design — não pode ser usado em
-- queries de aplicação. Criamos roles dedicados:
--
--   logifit_app    — connection pool das Server Actions / API Routes (RLS aplica)
--   logifit_admin  — connection pool de jobs cron / migrations (RLS aplica;
--                    pode ser elevado pra BYPASSRLS via SET LOCAL ROLE quando
--                    necessário, ex.: rotina anonymize-trial-data)
--
-- IDEMPOTENTE — `IF NOT EXISTS` em CREATE ROLE.

-- Role da aplicação (Server Actions / API Routes). NÃO é superuser, NÃO tem
-- BYPASSRLS. Senha vem de env var DATABASE_APP_PASSWORD ao usar pra conectar.
-- Em dev, senha é a mesma do postgres pra simplificar; em prod é diferente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logifit_app') THEN
    CREATE ROLE logifit_app WITH LOGIN PASSWORD 'logifit_app_dev_only';
  END IF;
END$$;

-- Grant nas tabelas existentes
GRANT USAGE ON SCHEMA public TO logifit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO logifit_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO logifit_app;

-- Tabelas criadas no futuro herdam grants (default privileges)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO logifit_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO logifit_app;

COMMENT ON ROLE logifit_app IS
  'Role das Server Actions/API Routes — RLS aplica (NÃO superuser, NÃO BYPASSRLS).';
