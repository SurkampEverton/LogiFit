-- Numero e serie do DOCUMENTO atribuidos pela autoridade fiscal.
--
-- `serie`/`numero` guardam o RPS que NOS geramos; a autoridade atribui outro
-- par ao autorizar. A primeira NFS-e real (2026-07-21) saiu como serie 1
-- numero 12 em Cascavel enquanto o RPS era serie 13 numero 6 — e a tela
-- exibia o RPS como se fosse a nota. Quem procurasse a nota 6 no portal do
-- municipio nao acharia nada, e a conciliacao com o contador quebraria.
--
-- Texto, nao inteiro: municipio e SEFAZ nao garantem numeracao numerica pura
-- e serie pode ser alfanumerica.
ALTER TABLE fiscal_emissions
  ADD COLUMN IF NOT EXISTS numero_documento text,
  ADD COLUMN IF NOT EXISTS serie_documento text;

COMMENT ON COLUMN fiscal_emissions.numero_documento IS
  'Numero da nota atribuido pela autoridade fiscal (distinto de numero, que e o RPS)';
COMMENT ON COLUMN fiscal_emissions.serie_documento IS
  'Serie da nota atribuida pela autoridade fiscal (distinta de serie, que e a do RPS)';
