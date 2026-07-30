-- Motor tributário — Sprint 41b (ADR 0108, regra 47).
--
-- Escrita à mão, como as migrations 0059-0066: o snapshot do drizzle-kit drifou
-- das migrations manuais e `db:generate` produz um catch-up de 590 linhas com
-- tabelas que já existem no banco. Regenerar o snapshot é dívida própria, não
-- deste sprint.
--
-- Inverte o modelo anterior: o produto deixa de carregar alíquota e passa a
-- carregar apenas classificadores. A tributação vive em `tax_rules` e é
-- resolvida na emissão, combinando produto × unidade emissora × destinatário ×
-- natureza da operação.

-- ═══════════════════════════════════════════════════════════════════════════
-- CATÁLOGO NACIONAL — sem tenant_id
-- ═══════════════════════════════════════════════════════════════════════════
-- Exceção declarada à regra 1, com precedente do ADR 0028 (CID/CIF). São dados
-- da legislação federal, iguais para todos os tenants: replicar por tenant
-- multiplicaria a manutenção sem isolar nada que seja de alguém.
-- Registradas por prefixo no allowlist de `db:rls-check`.

-- A tabela que dirige o cálculo. Comportamento de cada CST vive aqui como FLAG,
-- nunca como `switch` no código: CST novo, ou mudança de regra, é linha nesta
-- tabela em vez de deploy.
CREATE TABLE IF NOT EXISTS tax_ref_icms_cst (
  cst                    text PRIMARY KEY,
  descricao              text NOT NULL,
  calcula_icms_proprio   boolean NOT NULL DEFAULT false,
  calcula_st             boolean NOT NULL DEFAULT false,
  calcula_reducao_bc     boolean NOT NULL DEFAULT false,
  calcula_diferimento    boolean NOT NULL DEFAULT false,
  calcula_desoneracao    boolean NOT NULL DEFAULT false,
  calcula_st_retido      boolean NOT NULL DEFAULT false,
  requer_mod_bc          boolean NOT NULL DEFAULT false,
  requer_mod_bc_st       boolean NOT NULL DEFAULT false,
  requer_mva_ou_pauta    boolean NOT NULL DEFAULT false,
  legislacao             text
);

COMMENT ON TABLE tax_ref_icms_cst IS
  'Comportamento por CST de ICMS como flags — dirige calculateTax(). Sem tenant_id: catalogo nacional (regra 47, precedente ADR 0028).';

CREATE TABLE IF NOT EXISTS tax_ref_csosn (
  csosn              text PRIMARY KEY,
  descricao          text NOT NULL,
  permite_credito    boolean NOT NULL DEFAULT false,
  calcula_st         boolean NOT NULL DEFAULT false,
  calcula_st_retido  boolean NOT NULL DEFAULT false,
  legislacao         text
);

COMMENT ON TABLE tax_ref_csosn IS
  'CSOSN do Simples (CRT 1 e 2). Grupo XML <ICMSSN..> e distinto do <ICMS..> do regime Normal.';

-- `calcula_percentual` vs `calcula_quantidade` separa <PISAliq> de <PISQtde>.
-- Confundir os dois e rejeicao garantida.
CREATE TABLE IF NOT EXISTS tax_ref_pis_cofins_cst (
  cst                 text PRIMARY KEY,
  descricao           text NOT NULL,
  calcula_percentual  boolean NOT NULL DEFAULT false,
  calcula_quantidade  boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS tax_ref_ipi_cst (
  cst          text PRIMARY KEY,
  descricao    text NOT NULL,
  calcula_ipi  boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS tax_ref_icms_origem (
  origem     text PRIMARY KEY,
  descricao  text NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_ref_mod_bc (
  codigo     text PRIMARY KEY,
  descricao  text NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_ref_mod_bc_st (
  codigo     text PRIMARY KEY,
  descricao  text NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_ref_cfop (
  cfop            text PRIMARY KEY,
  descricao       text NOT NULL,
  tipo            text NOT NULL,
  interestadual   boolean NOT NULL DEFAULT false,
  CONSTRAINT tax_ref_cfop_tipo_valid CHECK (tipo IN ('entrada', 'saida'))
);

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFIGURAÇÃO POR TENANT
-- ═══════════════════════════════════════════════════════════════════════════

-- Divergência entre a natureza que o contexto resolve e a que está na regra é a
-- causa numero 1 de "nenhuma regra casou". Catálogo em vez de texto livre.
CREATE TABLE IF NOT EXISTS operation_natures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  code        text NOT NULL,
  label       text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS operation_natures_tenant_code_uq
  ON operation_natures (tenant_id, code);

CREATE TABLE IF NOT EXISTS operation_nature_defaults (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  company_id              uuid REFERENCES companies(id) ON DELETE CASCADE,
  context                 text NOT NULL,
  operation_nature_code   text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS operation_nature_defaults_uq
  ON operation_nature_defaults (tenant_id, company_id, context);

-- Agrupador de produtos com comportamento tributário idêntico.
-- DELETE cascateia nas regras de propósito: perfil sem regra não emite nada, e
-- deixá-lo órfão só cria configuração morta que confunde o operador.
CREATE TABLE IF NOT EXISTS fiscal_profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         text NOT NULL,
  description  text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_profiles_tenant_name_uq
  ON fiscal_profiles (tenant_id, name);

-- "Para este perfil, nesta operação, neste contexto -> estes CST/CFOP/aliquotas".
--
-- Alíquotas em BASIS POINTS inteiros (1% = 100 bp). Float binário é proibido na
-- cadeia fiscal (regra 47): 0.1 + 0.2 != 0.3 vira centavo errado na nota, e
-- centavo errado em nota autorizada e passivo fiscal do cliente.
--
-- Colunas de reforma (IBS/CBS) já nascem aqui para o Sprint 46 não precisar de
-- migration estrutural — NT 2025.002 e obrigatoria pro Simples em 04/01/2027.
CREATE TABLE IF NOT EXISTS tax_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  fiscal_profile_id     uuid NOT NULL REFERENCES fiscal_profiles(id) ON DELETE CASCADE,

  -- contexto (chave de casamento)
  operation_nature      text NOT NULL,
  uf_origem             text[],
  uf_destino            text[],
  -- ARMADILHA 1: o resolver de item na emissao de venda NAO preenche
  -- client_type; regra com este campo preenchido e descartada nesse fluxo.
  -- Regra de venda deve deixar NULL.
  client_type           text,
  regime                text,
  unit_id               uuid REFERENCES units(id) ON DELETE CASCADE,
  ncm                   text,
  cest                  text,
  municipio_incidencia  text,

  -- desempate e vigência
  priority              integer NOT NULL DEFAULT 0,
  valid_from            timestamptz,
  valid_until           timestamptz,
  active                boolean NOT NULL DEFAULT true,

  -- ICMS
  icms_cst              text,
  -- ARMADILHA 2: por convencao historica o CSOSN as vezes vem em icms_cst.
  -- resolveCsosn aceita as duas formas — sem isso, tenant do Simples emitia
  -- <CSOSN> vazio e a nota era rejeitada.
  csosn                 text,
  icms_aliq_bp          integer,
  icms_reducao_bc_bp    integer,
  origem                text,
  mod_bc                text,
  p_diferimento_bp      integer,
  mot_des_icms          text,

  -- ICMS-ST
  mva_st_bp             integer,
  mod_bc_st             text,
  p_red_bc_st_bp        integer,
  p_icms_st_bp          integer,
  v_bc_st_ret_cents     integer,
  p_st_bp               integer,

  -- PIS / COFINS
  pis_cst               text,
  pis_aliq_bp           integer,
  pis_aliq_unit_cents   integer,
  cofins_cst            text,
  cofins_aliq_bp        integer,
  cofins_aliq_unit_cents integer,

  -- IPI
  ipi_cst               text,
  ipi_aliq_bp           integer,

  -- ISS (NFS-e)
  iss_aliq_bp           integer,
  iss_retido            boolean NOT NULL DEFAULT false,
  codigo_servico        text,
  iss_local_prestacao   text,

  -- retenções
  irrf_aliq_bp          integer,
  irrf_retido           boolean NOT NULL DEFAULT false,
  inss_aliq_bp          integer,
  inss_retido           boolean NOT NULL DEFAULT false,
  csll_aliq_bp          integer,
  csll_retido           boolean NOT NULL DEFAULT false,
  pis_retido            boolean NOT NULL DEFAULT false,
  cofins_retido         boolean NOT NULL DEFAULT false,
  retencao_minima_cents integer,

  -- reforma tributária (NT 2025.002) — Sprint 46
  class_trib            text,
  aliq_cbs_bp           integer,
  aliq_ibs_uf_bp        integer,
  aliq_ibs_municipio_bp integer,

  -- CFOP
  cfop                  text,
  cfop_externo          text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Alíquota fora de 0-100% e erro de digitação, não regra exótica.
  CONSTRAINT tax_rules_aliquotas_range CHECK (
    (icms_aliq_bp   IS NULL OR icms_aliq_bp   BETWEEN 0 AND 10000)
    AND (iss_aliq_bp    IS NULL OR iss_aliq_bp    BETWEEN 0 AND 10000)
    AND (pis_aliq_bp    IS NULL OR pis_aliq_bp    BETWEEN 0 AND 10000)
    AND (cofins_aliq_bp IS NULL OR cofins_aliq_bp BETWEEN 0 AND 10000)
  ),
  -- valid_until antes de valid_from some da resolucao sem avisar ninguem.
  CONSTRAINT tax_rules_vigencia_coerente CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from
  ),
  -- ISS so incide no municipio do prestador ou do tomador.
  CONSTRAINT tax_rules_iss_local_valid CHECK (
    iss_local_prestacao IS NULL OR iss_local_prestacao IN ('P', 'T')
  )
);

-- Caminho quente da resolução: FindMatching(profile, natureza).
CREATE INDEX IF NOT EXISTS tax_rules_match_idx
  ON tax_rules (tenant_id, fiscal_profile_id, operation_nature)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS tax_rules_unit_idx
  ON tax_rules (unit_id)
  WHERE unit_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Classificadores no produto
-- ═══════════════════════════════════════════════════════════════════════════
-- `products` já trazia barcode/ncm/cest_code do Sprint 24. Falta o vínculo com
-- o perfil — sem ele a emissão aborta com erro nominal (regra 47), nunca com
-- default chutado.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fiscal_profile_id uuid REFERENCES fiscal_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origem text,
  ADD COLUMN IF NOT EXISTS sped_item_type text,
  ADD COLUMN IF NOT EXISTS fator_conversao_tributavel numeric,
  ADD COLUMN IF NOT EXISTS sem_gtin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN products.fiscal_profile_id IS
  'Perfil fiscal. Obrigatorio pra emitir: produto sem perfil aborta com erro nominal (regra 47).';

-- ═══════════════════════════════════════════════════════════════════════════
-- Modo sombra (ADR 0108)
-- ═══════════════════════════════════════════════════════════════════════════
-- Não dá pra comparar nosso XML com o da Focus — ela monta o XML internamente e
-- não o expõe. O que dá pra comparar é o NOSSO CÁLCULO contra os valores da nota
-- que ela já autorizou. Zero transmissão, zero risco, e acumula a evidência que
-- libera o cut-over por tenant no Sprint 42.

CREATE TABLE IF NOT EXISTS fiscal_tax_shadow_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  emission_id   uuid NOT NULL REFERENCES fiscal_emissions(id) ON DELETE CASCADE,
  computed      jsonb NOT NULL,
  authorized    jsonb,
  diverged      boolean,
  diff          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Painel de divergência: só interessa o que divergiu, e é minoria esperada.
CREATE INDEX IF NOT EXISTS fiscal_tax_shadow_diverged_idx
  ON fiscal_tax_shadow_runs (tenant_id, created_at DESC)
  WHERE diverged = true;

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_tax_shadow_emission_uq
  ON fiscal_tax_shadow_runs (emission_id);

COMMENT ON TABLE fiscal_tax_shadow_runs IS
  'Modo sombra: calculo do motor proprio vs valores do documento autorizado pelo provider. Gate de cut-over (ADR 0108).';
