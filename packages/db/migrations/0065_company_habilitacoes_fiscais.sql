-- 0065 — Habilitações fiscais por empresa (ADR 0105).
--
-- O cadastro de empresa na Focus (`POST/PUT /v2/empresas`) exige declarar quais
-- documentos a empresa emite: `habilita_nfse`, `habilita_nfe`, `habilita_nfce`.
-- Isso era decisão implícita no LogiFit — não havia onde registrar, então não
-- havia como montar o payload de cadastro sem chutar.
--
-- Default conservador: só NFS-e ligada. É o caso de uso central (academia,
-- fisio, nutri faturam serviço); NF-e/NFC-e só aparecem em quem vende produto
-- (Sprint 24 POS). Ligar emissão que o tenant não usa cria superfície fiscal
-- sem contrapartida.
--
-- @volume_estimate_yearly: 0 (colunas em tabela existente)

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS habilita_nfse boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS habilita_nfe  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS habilita_nfce boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN companies.habilita_nfse IS
  'Empresa emite NFS-e (servico). Espelha habilita_nfse no cadastro Focus.';
COMMENT ON COLUMN companies.habilita_nfe IS
  'Empresa emite NF-e modelo 55 (produto). Espelha habilita_nfe no cadastro Focus.';
COMMENT ON COLUMN companies.habilita_nfce IS
  'Empresa emite NFC-e modelo 65 (varejo balcao). Espelha habilita_nfce no cadastro Focus.';
