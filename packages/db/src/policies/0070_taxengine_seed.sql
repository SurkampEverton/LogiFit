-- packages/db/src/policies/0070_taxengine_seed.sql
-- Sprint 41b — seed do catálogo nacional `tax_ref_*` (ADR 0108, regra 47).
--
-- Vive em `policies/` e não em `migrations/` porque roda **sempre** e é
-- idempotente (`ON CONFLICT DO UPDATE`), mesmo critério do `0007_rbac_seed.sql`:
-- é dado canônico que o código pressupõe existir, não estado histórico.
--
-- Fonte: Tabelas A e B do Anexo do Convênio s/nº de 1970 (origem e CST de
-- ICMS), Anexo I do Ajuste SINIEF 07/2005 (CSOSN), tabelas de CST de PIS/COFINS
-- e IPI da EFD.
--
-- ⚠️ As flags aqui **dirigem o cálculo do imposto**. Alterar uma linha muda o
-- valor de toda nota futura que use aquele CST. Mudança exige conferência
-- contra a legislação citada em `legislacao`, nunca "parece certo".

-- ─── Origem da mercadoria (Tabela A) ───────────────────────────────────
INSERT INTO tax_ref_icms_origem (origem, descricao) VALUES
  ('0', 'Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8'),
  ('1', 'Estrangeira — importação direta, exceto a indicada no código 6'),
  ('2', 'Estrangeira — adquirida no mercado interno, exceto a indicada no código 7'),
  ('3', 'Nacional, conteúdo de importação superior a 40% e até 70%'),
  ('4', 'Nacional, produção conforme processos produtivos básicos'),
  ('5', 'Nacional, conteúdo de importação igual ou inferior a 40%'),
  ('6', 'Estrangeira — importação direta, sem similar nacional (lista CAMEX)'),
  ('7', 'Estrangeira — adquirida no mercado interno, sem similar nacional (lista CAMEX)'),
  ('8', 'Nacional, conteúdo de importação superior a 70%')
ON CONFLICT (origem) DO UPDATE SET descricao = EXCLUDED.descricao;

-- ─── Modalidade de base de cálculo do ICMS próprio ─────────────────────
INSERT INTO tax_ref_mod_bc (codigo, descricao) VALUES
  ('0', 'Margem Valor Agregado (%)'),
  ('1', 'Pauta (valor)'),
  ('2', 'Preço tabelado máximo (valor)'),
  ('3', 'Valor da operação')
ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao;

-- ─── Modalidade de base de cálculo do ICMS-ST ──────────────────────────
INSERT INTO tax_ref_mod_bc_st (codigo, descricao) VALUES
  ('0', 'Preço tabelado ou máximo sugerido'),
  ('1', 'Lista negativa (valor)'),
  ('2', 'Lista positiva (valor)'),
  ('3', 'Lista neutra (valor)'),
  ('4', 'Margem Valor Agregado (%)'),
  ('5', 'Pauta (valor)'),
  ('6', 'Valor da operação')
ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao;

-- ─── CST de ICMS (Tabela B) — as flags que dirigem o cálculo ───────────
-- Lê-se: "CST 20 tem icms_proprio e reducao_bc ligados, então o cálculo reduz a
-- base e depois aplica a alíquota". Nenhum `switch (cst)` no código.
INSERT INTO tax_ref_icms_cst (
  cst, descricao,
  calcula_icms_proprio, calcula_st, calcula_reducao_bc, calcula_diferimento,
  calcula_desoneracao, calcula_st_retido,
  requer_mod_bc, requer_mod_bc_st, requer_mva_ou_pauta, legislacao
) VALUES
  ('00', 'Tributada integralmente',
   true,  false, false, false, false, false,  true,  false, false, 'Conv. s/nº 1970, Tabela B'),
  ('10', 'Tributada e com cobrança do ICMS por substituição tributária',
   true,  true,  false, false, false, false,  true,  true,  true,  'Conv. s/nº 1970, Tabela B'),
  ('20', 'Com redução de base de cálculo',
   true,  false, true,  false, false, false,  true,  false, false, 'Conv. s/nº 1970, Tabela B'),
  ('30', 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária',
   false, true,  false, false, true,  false,  false, true,  true,  'Conv. s/nº 1970, Tabela B'),
  ('40', 'Isenta',
   false, false, false, false, true,  false,  false, false, false, 'Conv. s/nº 1970, Tabela B'),
  ('41', 'Não tributada',
   false, false, false, false, true,  false,  false, false, false, 'Conv. s/nº 1970, Tabela B'),
  ('50', 'Suspensão',
   false, false, false, false, true,  false,  false, false, false, 'Conv. s/nº 1970, Tabela B'),
  ('51', 'Diferimento',
   true,  false, false, true,  false, false,  true,  false, false, 'Conv. s/nº 1970, Tabela B'),
  ('60', 'ICMS cobrado anteriormente por substituição tributária',
   false, false, false, false, false, true,   false, false, false, 'Conv. s/nº 1970, Tabela B'),
  ('70', 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária',
   true,  true,  true,  false, false, false,  true,  true,  true,  'Conv. s/nº 1970, Tabela B'),
  ('90', 'Outras',
   true,  false, false, false, false, false,  true,  false, false, 'Conv. s/nº 1970, Tabela B')
ON CONFLICT (cst) DO UPDATE SET
  descricao            = EXCLUDED.descricao,
  calcula_icms_proprio = EXCLUDED.calcula_icms_proprio,
  calcula_st           = EXCLUDED.calcula_st,
  calcula_reducao_bc   = EXCLUDED.calcula_reducao_bc,
  calcula_diferimento  = EXCLUDED.calcula_diferimento,
  calcula_desoneracao  = EXCLUDED.calcula_desoneracao,
  calcula_st_retido    = EXCLUDED.calcula_st_retido,
  requer_mod_bc        = EXCLUDED.requer_mod_bc,
  requer_mod_bc_st     = EXCLUDED.requer_mod_bc_st,
  requer_mva_ou_pauta  = EXCLUDED.requer_mva_ou_pauta,
  legislacao           = EXCLUDED.legislacao;

-- ─── CSOSN (Simples Nacional, CRT 1 e 2) ───────────────────────────────
-- É o caminho da esmagadora maioria dos tenants LogiFit: academia e clínica são
-- ME/EPP do Simples. O 102 (sem crédito) é o default de revenda de suplemento.
INSERT INTO tax_ref_csosn (csosn, descricao, permite_credito, calcula_st, calcula_st_retido, legislacao) VALUES
  ('101', 'Tributada pelo Simples Nacional com permissão de crédito',      true,  false, false, 'Ajuste SINIEF 07/2005, Anexo I'),
  ('102', 'Tributada pelo Simples Nacional sem permissão de crédito',      false, false, false, 'Ajuste SINIEF 07/2005, Anexo I'),
  ('103', 'Isenção do ICMS no Simples Nacional para faixa de receita bruta', false, false, false, 'Ajuste SINIEF 07/2005, Anexo I'),
  ('201', 'Tributada com permissão de crédito e com cobrança do ICMS por ST', true,  true,  false, 'Ajuste SINIEF 07/2005, Anexo I'),
  ('202', 'Tributada sem permissão de crédito e com cobrança do ICMS por ST', false, true,  false, 'Ajuste SINIEF 07/2005, Anexo I'),
  ('203', 'Isenção do ICMS para faixa de receita bruta e com cobrança por ST', false, true,  false, 'Ajuste SINIEF 07/2005, Anexo I'),
  ('300', 'Imune',                                                          false, false, false, 'Ajuste SINIEF 07/2005, Anexo I'),
  ('400', 'Não tributada pelo Simples Nacional',                            false, false, false, 'Ajuste SINIEF 07/2005, Anexo I'),
  ('500', 'ICMS cobrado anteriormente por ST ou por antecipação',           false, false, true,  'Ajuste SINIEF 07/2005, Anexo I'),
  ('900', 'Outros',                                                         false, false, false, 'Ajuste SINIEF 07/2005, Anexo I')
ON CONFLICT (csosn) DO UPDATE SET
  descricao         = EXCLUDED.descricao,
  permite_credito   = EXCLUDED.permite_credito,
  calcula_st        = EXCLUDED.calcula_st,
  calcula_st_retido = EXCLUDED.calcula_st_retido,
  legislacao        = EXCLUDED.legislacao;

-- ─── CST de PIS/COFINS ─────────────────────────────────────────────────
-- A distinção que importa: percentual gera <PISAliq>, quantidade gera <PISQtde>.
-- São grupos XML diferentes; trocar um pelo outro é rejeição certa.
INSERT INTO tax_ref_pis_cofins_cst (cst, descricao, calcula_percentual, calcula_quantidade) VALUES
  ('01', 'Operação tributável com alíquota básica',                        true,  false),
  ('02', 'Operação tributável com alíquota diferenciada',                   true,  false),
  ('03', 'Operação tributável com alíquota por unidade de medida',          false, true),
  ('04', 'Operação tributável monofásica — revenda a alíquota zero',        false, false),
  ('05', 'Operação tributável por substituição tributária',                 false, false),
  ('06', 'Operação tributável a alíquota zero',                             false, false),
  ('07', 'Operação isenta da contribuição',                                 false, false),
  ('08', 'Operação sem incidência da contribuição',                         false, false),
  ('09', 'Operação com suspensão da contribuição',                          false, false),
  ('49', 'Outras operações de saída',                                       false, false),
  ('99', 'Outras operações',                                                false, false)
ON CONFLICT (cst) DO UPDATE SET
  descricao          = EXCLUDED.descricao,
  calcula_percentual = EXCLUDED.calcula_percentual,
  calcula_quantidade = EXCLUDED.calcula_quantidade;

-- ─── CST de IPI (saída) ────────────────────────────────────────────────
-- LogiFit revende; não industrializa. Só os CST de saída importam.
INSERT INTO tax_ref_ipi_cst (cst, descricao, calcula_ipi) VALUES
  ('50', 'Saída tributada',                    true),
  ('51', 'Saída tributável com alíquota zero', false),
  ('52', 'Saída isenta',                       false),
  ('53', 'Saída não tributada',                false),
  ('54', 'Saída imune',                        false),
  ('55', 'Saída com suspensão',                false),
  ('99', 'Outras saídas',                      true)
ON CONFLICT (cst) DO UPDATE SET
  descricao   = EXCLUDED.descricao,
  calcula_ipi = EXCLUDED.calcula_ipi;

-- ─── CFOP ──────────────────────────────────────────────────────────────
-- Espelha exatamente o `CANONICAL_CFOPS` de `@repo/ai/fiscal/cfop-resolver`
-- (Sprint 36a, 31 testes verdes). O catálogo aqui serve à validação e ao seletor
-- da UI; a derivação por operação continua no resolver puro, que já é testado.
-- Divergir as duas listas silenciosamente seria pior que não ter a tabela.
INSERT INTO tax_ref_cfop (cfop, descricao, tipo, interestadual) VALUES
  ('5101', 'Venda de produção do estabelecimento',            'saida',   false),
  ('5102', 'Venda de mercadoria adquirida de terceiros',      'saida',   false),
  ('5152', 'Transferência de mercadoria de terceiros',        'saida',   false),
  ('5202', 'Devolução de compra para comercialização',        'saida',   false),
  ('5551', 'Venda de bem do ativo imobilizado',               'saida',   false),
  ('5915', 'Remessa para conserto',                           'saida',   false),
  ('5949', 'Outra saída não especificada',                    'saida',   false),
  ('6101', 'Venda de produção — interestadual',               'saida',   true),
  ('6102', 'Venda de mercadoria de terceiros — interestadual', 'saida',  true),
  ('6152', 'Transferência de mercadoria — interestadual',     'saida',   true),
  ('6202', 'Devolução de compra — interestadual',             'saida',   true),
  ('6551', 'Venda de ativo imobilizado — interestadual',      'saida',   true),
  ('6915', 'Remessa para conserto — interestadual',           'saida',   true),
  ('6949', 'Outra saída — interestadual',                     'saida',   true),
  ('1915', 'Entrada de bem para conserto',                    'entrada', false),
  ('1917', 'Entrada em consignação industrial',               'entrada', false),
  ('2915', 'Retorno de conserto — interestadual',             'entrada', true),
  ('2917', 'Entrada em consignação — interestadual',          'entrada', true)
ON CONFLICT (cfop) DO UPDATE SET
  descricao     = EXCLUDED.descricao,
  tipo          = EXCLUDED.tipo,
  interestadual = EXCLUDED.interestadual;
