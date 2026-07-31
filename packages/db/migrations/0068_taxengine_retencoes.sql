-- Correções do motor tributário — Sprint 41c (ADR 0108, regra 47).
--
-- Três defeitos achados na revisão adversarial do cálculo, todos com efeito em
-- valor de nota:
--
-- 1. Não havia alíquota de retenção de PIS/COFINS. O motor caía na alíquota de
--    SAÍDA, que é outra coisa. Coincide no Simples e no Presumido cumulativo
--    (0,65% / 3%), diverge no Lucro Real não-cumulativo (1,65% / 7,6%) — ali o
--    tenant retinha mais que o dobro do devido.
--
-- 2. `p_diferimento_bp` e `icms_reducao_bc_bp` ficaram de fora do CHECK de
--    faixa. Diferimento de 120% (erro de escala) produzia ICMS **negativo**,
--    que contaminava o total da nota.
--
-- 3. `v_bc_st_ret_cents` era valor absoluto na regra, compartilhado por todas
--    as emissões que casassem — não escalava com o item. Passa a ser pauta
--    UNITÁRIA, multiplicada pela quantidade do item no cálculo.

-- ── 1. Alíquotas de retenção próprias ──────────────────────────────────────
-- Sem default: regra 47 proíbe inferir. `pis_retido=true` sem alíquota aborta
-- a emissão dizendo qual campo falta, em vez de usar a de saída em silêncio.
ALTER TABLE tax_rules
  ADD COLUMN IF NOT EXISTS pis_retido_aliq_bp    integer,
  ADD COLUMN IF NOT EXISTS cofins_retido_aliq_bp integer;

COMMENT ON COLUMN tax_rules.pis_retido_aliq_bp IS
  'Aliquota do PIS RETIDO na fonte (PCC), distinta da aliquota de saida. Tipicamente 65 bp (0,65%).';
COMMENT ON COLUMN tax_rules.cofins_retido_aliq_bp IS
  'Aliquota da COFINS RETIDA na fonte (PCC), distinta da aliquota de saida. Tipicamente 300 bp (3%).';

-- ── 2. Faixa das alíquotas que faltavam ────────────────────────────────────
ALTER TABLE tax_rules DROP CONSTRAINT IF EXISTS tax_rules_aliquotas_range;

ALTER TABLE tax_rules ADD CONSTRAINT tax_rules_aliquotas_range CHECK (
  (icms_aliq_bp          IS NULL OR icms_aliq_bp          BETWEEN 0 AND 10000)
  AND (iss_aliq_bp           IS NULL OR iss_aliq_bp           BETWEEN 0 AND 10000)
  AND (pis_aliq_bp           IS NULL OR pis_aliq_bp           BETWEEN 0 AND 10000)
  AND (cofins_aliq_bp        IS NULL OR cofins_aliq_bp        BETWEEN 0 AND 10000)
  -- Acima de 100% de diferimento o ICMS devido fica negativo.
  AND (p_diferimento_bp      IS NULL OR p_diferimento_bp      BETWEEN 0 AND 10000)
  AND (icms_reducao_bc_bp    IS NULL OR icms_reducao_bc_bp    BETWEEN 0 AND 10000)
  AND (p_red_bc_st_bp        IS NULL OR p_red_bc_st_bp        BETWEEN 0 AND 10000)
  AND (p_icms_st_bp          IS NULL OR p_icms_st_bp          BETWEEN 0 AND 10000)
  AND (ipi_aliq_bp           IS NULL OR ipi_aliq_bp           BETWEEN 0 AND 10000)
  AND (irrf_aliq_bp          IS NULL OR irrf_aliq_bp          BETWEEN 0 AND 10000)
  AND (inss_aliq_bp          IS NULL OR inss_aliq_bp          BETWEEN 0 AND 10000)
  AND (csll_aliq_bp          IS NULL OR csll_aliq_bp          BETWEEN 0 AND 10000)
  AND (pis_retido_aliq_bp    IS NULL OR pis_retido_aliq_bp    BETWEEN 0 AND 10000)
  AND (cofins_retido_aliq_bp IS NULL OR cofins_retido_aliq_bp BETWEEN 0 AND 10000)
  -- MVA pode passar de 100% (é acréscimo, não fração), mas não ser negativa.
  AND (mva_st_bp             IS NULL OR mva_st_bp             >= 0)
);

-- ── 3. ST retido vira pauta unitária ───────────────────────────────────────
-- O nome antigo dizia "base do ST retido"; era lido como valor da operação
-- inteira e não escalava com a quantidade. Renomear força quem lê a notar.
ALTER TABLE tax_rules RENAME COLUMN v_bc_st_ret_cents TO v_bc_st_ret_unit_cents;

COMMENT ON COLUMN tax_rules.v_bc_st_ret_unit_cents IS
  'Base do ICMS-ST ja retido, POR UNIDADE em centavos. O calculo multiplica pela quantidade do item. Valor por item vindo do XML de compra tem precedencia sobre esta pauta.';
