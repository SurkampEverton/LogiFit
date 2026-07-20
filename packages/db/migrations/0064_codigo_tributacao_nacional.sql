-- 0064 — Código de Tributação Nacional (6 dígitos) no catálogo de serviços.
--
-- O padrão nacional de NFS-e (CGNFS-e) identifica o serviço por um código de
-- **6 dígitos**: item(2) + subitem(2) + desdobramento(2). O desdobramento é
-- criação do padrão nacional e não existe na LC 116/2003 — por isso "1.06"
-- (item da lei) e "010601" (código nacional) são coisas distintas e convivem.
--
-- Municípios já migrados para o padrão nacional recusam o formato antigo. Foi
-- o que travou a primeira emissão real em Cascavel/PR (AtendeNet, 2026-07-20):
--   "Lista de Serviço informada não possui desdobramento nacional"
--
-- Mantemos `lc116_code` porque continua sendo a referência legal exibida ao
-- operador e usada por municípios ainda no padrão antigo; o builder de NFS-e
-- prefere o código nacional quando existe.
--
-- @volume_estimate_yearly: 0 (coluna em tabela existente)

ALTER TABLE fiscal_service_catalog
  ADD COLUMN IF NOT EXISTS codigo_tributacao_nacional text;

ALTER TABLE fiscal_service_catalog
  DROP CONSTRAINT IF EXISTS fiscal_service_catalog_codigo_nacional_format;
ALTER TABLE fiscal_service_catalog
  ADD CONSTRAINT fiscal_service_catalog_codigo_nacional_format
  CHECK (codigo_tributacao_nacional IS NULL OR codigo_tributacao_nacional ~ '^[0-9]{6}$');

COMMENT ON COLUMN fiscal_service_catalog.codigo_tributacao_nacional IS
  'Codigo de Tributacao Nacional CGNFS-e: item(2)+subitem(2)+desdobramento(2). Ex.: 010601 = LC 1.06 assessoria e consultoria em informatica. NULL = municipio ainda no padrao antigo (usa lc116_code).';
