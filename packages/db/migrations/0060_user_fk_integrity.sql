-- packages/db/migrations/0060_user_fk_integrity.sql
-- Fecha o bug sistêmico `session.user.id` em colunas que referenciam users.id
-- (descoberto 2026-07-20 — ver roadmap "Bug sistêmico corrigido").
--
-- O código já foi corrigido (90 ocorrências em 25 arquivos). Esta migration:
--   1. REPARA linhas gravadas com auth_user.id, mapeando pro users.id do mesmo tenant
--   2. ADICIONA as FKs faltantes — sem elas o erro voltava a ser silencioso
--
-- Reparo é conservador: só corrige onde o mapeamento auth_user → users é
-- inequívoco (1 user por auth_user dentro do tenant da própria linha). O que
-- não mapear vira NULL — melhor um autor desconhecido do que um ID mentiroso
-- apontando pra registro que não existe.

-- ─── 1. Reparo dos dados ────────────────────────────────────────────────
UPDATE fiscal_emissions fe
SET created_by_user_id = u.id
FROM users u
WHERE u.auth_user_id = fe.created_by_user_id
  AND u.tenant_id = fe.tenant_id
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.id = fe.created_by_user_id);
--> statement-breakpoint
UPDATE fiscal_events fev
SET created_by_user_id = u.id
FROM users u
WHERE u.auth_user_id = fev.created_by_user_id
  AND u.tenant_id = fev.tenant_id
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.id = fev.created_by_user_id);
--> statement-breakpoint
UPDATE sales s
SET sold_by_user_id = u.id
FROM users u
WHERE u.auth_user_id = s.sold_by_user_id
  AND u.tenant_id = s.tenant_id
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.id = s.sold_by_user_id);
--> statement-breakpoint
-- Órfãos que não mapearam: zera (autor desconhecido > ID mentiroso)
UPDATE fiscal_emissions fe SET created_by_user_id = NULL
WHERE created_by_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.id = fe.created_by_user_id);
--> statement-breakpoint
UPDATE fiscal_events fev SET created_by_user_id = NULL
WHERE created_by_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.id = fev.created_by_user_id);
--> statement-breakpoint
UPDATE sales s SET sold_by_user_id = NULL
WHERE sold_by_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.id = s.sold_by_user_id);
--> statement-breakpoint
-- ─── 2. FKs faltantes ───────────────────────────────────────────────────
-- ON DELETE SET NULL: apagar um usuário não pode apagar nota fiscal nem venda
-- (documento fiscal é imutável — Lei 13.787 retenção); o autor vira desconhecido.
-- Idempotente: `sales` já ganhou a FK na 0055; as fiscais nasceram sem.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('fiscal_emissions', 'created_by_user_id', 'fiscal_emissions_created_by_user_id_users_id_fk'),
      ('fiscal_events',    'created_by_user_id', 'fiscal_events_created_by_user_id_users_id_fk'),
      ('sales',            'sold_by_user_id',    'sales_sold_by_user_id_users_id_fk')
    ) AS t(tbl, col, con)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = r.con
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE SET NULL',
        r.tbl, r.con, r.col);
      RAISE NOTICE 'FK criada: %.%', r.tbl, r.col;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- audit_log.actor_user_id fica SEM FK de propósito: a trilha é append-only e
-- deve sobreviver à remoção do usuário (regra 5) — o valor é histórico, não
-- referência viva. A auditoria de 2026-07-20 confirmou 0 linhas inválidas lá.
