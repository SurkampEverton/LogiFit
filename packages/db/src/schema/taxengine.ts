/**
 * Motor tributário — Sprint 41b ([ADR 0108](../../../../docs/decisions/0108-emissao-fiscal-propria-nfe-nfce-nfse.md), regra 47).
 *
 * Substitui a delegação de cálculo à Focus NFe. O princípio inverte o que
 * existia: **o produto não carrega alíquota**, carrega classificadores (NCM,
 * CEST, origem, perfil fiscal). A tributação vive em `tax_rules` e é resolvida
 * na emissão, combinando produto × unidade emissora × destinatário × natureza
 * da operação.
 *
 * Quatro camadas, nesta ordem:
 *   1. **Configuração** — este arquivo: `tax_ref_*`, `fiscal_profiles`, `tax_rules`
 *   2. **Resolução** — escolhe UMA regra por score + desempate determinístico
 *   3. **Cálculo** — aplica bases, dirigido por FLAGS de `tax_ref_icms_cst`
 *   4. **Emissão** — monta os grupos do XML
 *
 * **`tax_ref_*` não têm `tenant_id`** — catálogo canônico nacional, exceção
 * declarada na regra 47 com precedente do ADR 0028 (CID/CIF). Estão no
 * allowlist de `db:rls-check`, com prefixo, para que a exceção seja explícita e
 * não silenciosa.
 *
 * **Por que flags e não `switch`:** o comportamento de cada CST vive em
 * `tax_ref_icms_cst` como boolean. CST novo (ou mudança de regra) é linha na
 * tabela, não deploy. Um `switch (cst)` no cálculo teria que ser reaberto a cada
 * alteração da legislação, e é onde o motor de referência acumulou dívida.
 *
 * **Fora de escopo por decisão do ADR 0108:** monofásico de combustível, ANP,
 * PMPF, CIDE e cadeia de importação. LogiFit não vende combustível nem importa;
 * carregar essas colunas seria ~40% de complexidade sem caso de uso.
 *
 * @volume_estimate_yearly: 50000
 *   (regras são configuração: dezenas por tenant, não milhares. Sem partição.)
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { companies, units } from './identity'

// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO NACIONAL — sem tenant_id (regra 47, precedente ADR 0028)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * **A tabela mais importante do motor.**
 *
 * Guarda o *comportamento* de cada CST de ICMS como flag, e é ela que dirige
 * `calculateTax()`. Sem isso, o cálculo vira uma escada de `if (cst === '20')`
 * que precisa ser reaberta a cada nota técnica.
 *
 * Lida assim: "CST 20 tem `calculaIcmsProprio` e `calculaReducaoBc` ligados,
 * então o cálculo reduz a base e depois aplica a alíquota".
 */
export const taxRefIcmsCst = pgTable('tax_ref_icms_cst', {
  /** 2 dígitos: '00', '10', '20', '40', '41', '50', '51', '60', '70', '90'. */
  cst: text('cst').primaryKey(),
  descricao: text('descricao').notNull(),

  /** Destaca ICMS próprio na operação. */
  calculaIcmsProprio: boolean('calcula_icms_proprio').notNull().default(false),
  /** Calcula ICMS-ST nesta operação (exige MVA ou pauta). */
  calculaSt: boolean('calcula_st').notNull().default(false),
  /** Aplica redução de base antes da alíquota. */
  calculaReducaoBc: boolean('calcula_reducao_bc').notNull().default(false),
  /** Aplica percentual de diferimento sobre o ICMS apurado. */
  calculaDiferimento: boolean('calcula_diferimento').notNull().default(false),
  /** Operação desonerada — exige motivo da desoneração. */
  calculaDesoneracao: boolean('calcula_desoneracao').notNull().default(false),
  /** ICMS já retido por ST em operação anterior (CST 60). */
  calculaStRetido: boolean('calcula_st_retido').notNull().default(false),

  /** Exige `modBc` preenchido — sem ele o XML é rejeitado. */
  requerModBc: boolean('requer_mod_bc').notNull().default(false),
  requerModBcSt: boolean('requer_mod_bc_st').notNull().default(false),
  /** Exige MVA ou pauta para compor a base de ST. */
  requerMvaOuPauta: boolean('requer_mva_ou_pauta').notNull().default(false),

  legislacao: text('legislacao'),
})

/**
 * CSOSN — o equivalente ao CST para optante do Simples (CRT 1 e 2).
 *
 * Existe separado porque o emitente do Simples usa `<ICMSSN…>` no XML, um grupo
 * inteiramente distinto do `<ICMS…>` do regime Normal.
 */
export const taxRefCsosn = pgTable('tax_ref_csosn', {
  /** 3 dígitos: '101', '102', '103', '201', '202', '203', '300', '400', '500', '900'. */
  csosn: text('csosn').primaryKey(),
  descricao: text('descricao').notNull(),
  /** Permite ao destinatário aproveitar crédito (exige alíquota de crédito). */
  permiteCredito: boolean('permite_credito').notNull().default(false),
  /** Sujeito a ST. */
  calculaSt: boolean('calcula_st').notNull().default(false),
  /** ICMS já retido anteriormente por ST. */
  calculaStRetido: boolean('calcula_st_retido').notNull().default(false),
  legislacao: text('legislacao'),
})

/**
 * CST de PIS/COFINS.
 *
 * A distinção que importa: `calculaPercentual` (alíquota sobre valor) vs
 * `calculaQuantidade` (valor por unidade). São grupos XML diferentes —
 * `<PISAliq>` vs `<PISQtde>` — e confundir os dois é rejeição garantida.
 */
export const taxRefPisCofinsCst = pgTable('tax_ref_pis_cofins_cst', {
  cst: text('cst').primaryKey(),
  descricao: text('descricao').notNull(),
  calculaPercentual: boolean('calcula_percentual').notNull().default(false),
  calculaQuantidade: boolean('calcula_quantidade').notNull().default(false),
})

export const taxRefIpiCst = pgTable('tax_ref_ipi_cst', {
  cst: text('cst').primaryKey(),
  descricao: text('descricao').notNull(),
  calculaIpi: boolean('calcula_ipi').notNull().default(false),
})

/** Origem da mercadoria (0-8), tabela A do Anexo I do Convênio s/nº 1970. */
export const taxRefIcmsOrigem = pgTable('tax_ref_icms_origem', {
  origem: text('origem').primaryKey(),
  descricao: text('descricao').notNull(),
})

/** Modalidade de determinação da base de cálculo do ICMS próprio (0-3). */
export const taxRefModBc = pgTable('tax_ref_mod_bc', {
  codigo: text('codigo').primaryKey(),
  descricao: text('descricao').notNull(),
})

/** Modalidade de determinação da base de cálculo do ICMS-ST (0-6). */
export const taxRefModBcSt = pgTable('tax_ref_mod_bc_st', {
  codigo: text('codigo').primaryKey(),
  descricao: text('descricao').notNull(),
})

/**
 * CFOP.
 *
 * Complementa — não substitui — o `resolveCfop` puro que já existe em
 * `@repo/ai/fiscal/cfop-resolver` (Sprint 36a, 31 testes verdes). Aqui o CFOP é
 * catálogo para validação e para o seletor da UI de regras; a derivação por
 * operação continua no resolver.
 */
export const taxRefCfop = pgTable('tax_ref_cfop', {
  cfop: text('cfop').primaryKey(),
  descricao: text('descricao').notNull(),
  /** 'entrada' | 'saida' — o primeiro dígito decide. */
  tipo: text('tipo').notNull(),
  /** true para 6xxx/7xxx (fora do estado / exterior). */
  interestadual: boolean('interestadual').notNull().default(false),
})

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO POR TENANT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Natureza da operação.
 *
 * O código aqui é o que `tax_rules.operation_nature` casa. Divergência entre a
 * natureza que o contexto de emissão resolve e a que está na regra é a **causa
 * número 1** de "nenhuma regra casou" no motor de referência — por isso o campo
 * é FK conceitual contra este catálogo, não texto livre.
 */
export const operationNatures = pgTable(
  'operation_natures',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    /** Código canônico usado no match: 'VENDA', 'REVENDA', 'SERVICO', 'DEVOLUCAO'… */
    code: text('code').notNull(),
    /** Texto que vai no campo `natOp` do XML. */
    label: text('label').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('operation_natures_tenant_code_uq').on(t.tenantId, t.code)],
)

/**
 * Perfil fiscal — agrupador de produtos com comportamento tributário idêntico.
 *
 * Ex.: `SUPLEMENTO-REVENDA`, `SERVICO-ACADEMIA`, `ORTESE-REVENDA`. O produto
 * aponta para o perfil; o perfil tem N regras, uma por contexto.
 *
 * `DELETE` cascateia nas regras de propósito: perfil sem regra não emite nada,
 * então deixá-lo órfão só criaria configuração morta que confunde o operador.
 */
export const fiscalProfiles = pgTable(
  'fiscal_profiles',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('fiscal_profiles_tenant_name_uq').on(t.tenantId, t.name)],
)

/**
 * Regra fiscal: "para este perfil, nesta operação, neste contexto → estes
 * CST/CFOP/alíquotas".
 *
 * **Contexto (o que casa):** `fiscal_profile_id` + `operation_nature` são
 * obrigatórios; o resto é curinga quando nulo/vazio. Quanto mais campos
 * preenchidos, mais específica a regra e maior o score na resolução.
 *
 * **`ufOrigem`/`ufDestino` são arrays** — uma regra pode valer para um conjunto
 * de UFs sem virar N linhas duplicadas.
 *
 * **Alíquotas em basis points** (1% = 100 bp), inteiro. Float binário é proibido
 * na cadeia fiscal (regra 47): `0.1 + 0.2 !== 0.3` vira centavo errado na nota,
 * e centavo errado em nota autorizada é passivo fiscal do cliente.
 *
 * **Colunas de reforma (IBS/CBS) já nascem aqui** para o Sprint 46 não precisar
 * de migration estrutural — a NT 2025.002 é obrigatória para o Simples em
 * 04/01/2027.
 */
export const taxRules = pgTable(
  'tax_rules',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    fiscalProfileId: uuid('fiscal_profile_id')
      .notNull()
      .references(() => fiscalProfiles.id, { onDelete: 'cascade' }),

    // ─── Contexto (chave de casamento) ───────────────────────────────────
    /** Código da natureza; casa com `operation_natures.code`. Obrigatório. */
    operationNature: text('operation_nature').notNull(),
    /** UFs de origem cobertas. NULL ou vazio = qualquer. */
    ufOrigem: text('uf_origem').array(),
    ufDestino: text('uf_destino').array(),
    /**
     * 'PF' | 'PJ' | NULL.
     *
     * ⚠️ **Armadilha 1:** o resolver de item na emissão de venda **não preenche**
     * este campo, então qualquer regra com ele preenchido é descartada nesse
     * fluxo. Regra de venda deve deixar NULL. Documentado aqui porque custou um
     * incidente no motor de referência.
     */
    clientType: text('client_type'),
    /** 'simples_nacional' | 'lucro_presumido' | 'lucro_real' | 'mei' | NULL. */
    regime: text('regime'),
    /** Restringe a uma unidade emissora. NULL = tenant inteiro. */
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'cascade' }),
    /** Discrimina por produto dentro do mesmo perfil. Normalizado sem pontos. */
    ncm: text('ncm'),
    cest: text('cest'),
    /** Código IBGE, para ISS com incidência em município específico. */
    municipioIncidencia: text('municipio_incidencia'),

    // ─── Desempate e vigência ────────────────────────────────────────────
    /** Primeiro critério de desempate quando o score empata. */
    priority: integer('priority').notNull().default(0),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    active: boolean('active').notNull().default(true),

    // ─── Carga fiscal: ICMS ──────────────────────────────────────────────
    icmsCst: text('icms_cst'),
    /**
     * CSOSN para optante do Simples.
     *
     * ⚠️ **Armadilha 2:** por convenção histórica do motor de referência, o
     * CSOSN às vezes era gravado em `icms_cst`. `resolveCsosn` aceita as duas
     * formas — sem isso, 100% das notas de tenant do Simples saíam com `<CSOSN>`
     * vazio e eram rejeitadas.
     */
    csosn: text('csosn'),
    /** Alíquota de ICMS em basis points (1800 = 18%). */
    icmsAliqBp: integer('icms_aliq_bp'),
    /** Percentual de redução da base, em bp. */
    icmsReducaoBcBp: integer('icms_reducao_bc_bp'),
    origem: text('origem'),
    modBc: text('mod_bc'),
    /** Percentual de diferimento, em bp. */
    pDiferimentoBp: integer('p_diferimento_bp'),
    motDesIcms: text('mot_des_icms'),

    // ─── Carga fiscal: ICMS-ST ───────────────────────────────────────────
    mvaStBp: integer('mva_st_bp'),
    modBcSt: text('mod_bc_st'),
    pRedBcStBp: integer('p_red_bc_st_bp'),
    pIcmsStBp: integer('p_icms_st_bp'),
    /** Base de ST já retida em operação anterior, em centavos (CST 60). */
    vBcStRetCents: integer('v_bc_st_ret_cents'),
    pStBp: integer('p_st_bp'),

    // ─── PIS / COFINS ────────────────────────────────────────────────────
    pisCst: text('pis_cst'),
    pisAliqBp: integer('pis_aliq_bp'),
    /** Valor por unidade em centavos, para CST de tributação por quantidade. */
    pisAliqUnitCents: integer('pis_aliq_unit_cents'),
    cofinsCst: text('cofins_cst'),
    cofinsAliqBp: integer('cofins_aliq_bp'),
    cofinsAliqUnitCents: integer('cofins_aliq_unit_cents'),

    // ─── IPI ─────────────────────────────────────────────────────────────
    ipiCst: text('ipi_cst'),
    ipiAliqBp: integer('ipi_aliq_bp'),

    // ─── ISS (NFS-e) ─────────────────────────────────────────────────────
    issAliqBp: integer('iss_aliq_bp'),
    issRetido: boolean('iss_retido').notNull().default(false),
    /** Item da LC 116/2003 ou código de tributação nacional de 6 dígitos. */
    codigoServico: text('codigo_servico'),
    /** 'P' = município do prestador; 'T' = do tomador (exceções do art. 3º). */
    issLocalPrestacao: text('iss_local_prestacao'),

    // ─── Retenções ───────────────────────────────────────────────────────
    irrfAliqBp: integer('irrf_aliq_bp'),
    irrfRetido: boolean('irrf_retido').notNull().default(false),
    inssAliqBp: integer('inss_aliq_bp'),
    inssRetido: boolean('inss_retido').notNull().default(false),
    csllAliqBp: integer('csll_aliq_bp'),
    csllRetido: boolean('csll_retido').notNull().default(false),
    pisRetido: boolean('pis_retido').notNull().default(false),
    cofinsRetido: boolean('cofins_retido').notNull().default(false),
    /** Piso do documento para reter PCC, em centavos (Lei 10.833/2003: R$ 5.000). */
    retencaoMinimaCents: integer('retencao_minima_cents'),

    // ─── Reforma tributária (NT 2025.002) — Sprint 46 ────────────────────
    classTrib: text('class_trib'),
    aliqCbsBp: integer('aliq_cbs_bp'),
    aliqIbsUfBp: integer('aliq_ibs_uf_bp'),
    aliqIbsMunicipioBp: integer('aliq_ibs_municipio_bp'),

    // ─── CFOP ────────────────────────────────────────────────────────────
    /** CFOP para operação interna (5xxx). */
    cfop: text('cfop'),
    /** CFOP para operação interestadual (6xxx). */
    cfopExterno: text('cfop_externo'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Índice do caminho quente: `FindMatching(profile, natureza)`. */
    index('tax_rules_match_idx')
      .on(t.tenantId, t.fiscalProfileId, t.operationNature)
      .where(sql`active = true`),
    index('tax_rules_unit_idx').on(t.unitId).where(sql`unit_id IS NOT NULL`),
    /** Alíquotas em bp: 0-10000 (0% a 100%). Fora disso é erro de digitação. */
    check(
      'tax_rules_aliquotas_range',
      sql`(icms_aliq_bp IS NULL OR icms_aliq_bp BETWEEN 0 AND 10000)
          AND (iss_aliq_bp IS NULL OR iss_aliq_bp BETWEEN 0 AND 10000)
          AND (pis_aliq_bp IS NULL OR pis_aliq_bp BETWEEN 0 AND 10000)
          AND (cofins_aliq_bp IS NULL OR cofins_aliq_bp BETWEEN 0 AND 10000)`,
    ),
    /** Vigência coerente — `valid_until` antes de `valid_from` some da resolução. */
    check(
      'tax_rules_vigencia_coerente',
      sql`valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from`,
    ),
  ],
)

/**
 * Default de natureza por contexto de uso.
 *
 * Quando a emissão não recebe natureza explícita, resolve por aqui. Contextos:
 * `pos_nfce_sale`, `pos_nfe_sale`, `admin_nfe_sale`, `nfse_service`,
 * `nfe_return`, `intercompany_transfer`.
 */
export const operationNatureDefaults = pgTable(
  'operation_nature_defaults',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    context: text('context').notNull(),
    operationNatureCode: text('operation_nature_code').notNull(),
  },
  (t) => [uniqueIndex('operation_nature_defaults_uq').on(t.tenantId, t.companyId, t.context)],
)
