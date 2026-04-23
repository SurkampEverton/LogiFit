# Sprint 15 — Geral · ERP Financeiro Core (AP + AR + Plano de Contas + OCR boleto + NF-e XML)

- **Área:** geral
- **Início:** planejado (depois do Sprint 14)
- **Fim planejado:** +4 semanas — **⚠️ candidato à quebra em 15a (AP/AR core + plano contas + workflow aprovação) + 15b (OCR boleto multi-provider + NF-e XML + fornecedores import)** se estourar 3 semanas (regra 9). Decisão na abertura do sprint conforme estimativa detalhada.
- **Status:** planejado
- **Item do roadmap:** #17

## Goal

Transforma o módulo financeiro (que era focado em mensalidade Asaas + custos) em **ERP financeiro completo**: plano de contas contábil hierárquico, cadastro de fornecedores, contas a pagar (AP) e contas a receber (AR) com workflow de aprovação multi-nível, OCR de boleto para preenchimento automático, upload manual de XML NF-e com parser + criação automática de AP.

## Critério de aceite

**Plano de contas:**
- `chart_of_accounts` hierárquico (ativo/passivo/receita/despesa com subníveis) configurável por tenant
- Seed padrão com plano de contas brasileiro simplificado (receita operacional, despesas fixas, variáveis, impostos, folha, financeiras)
- Cada lançamento AP/AR vincula a 1 conta contábil

**Fornecedores:**
- `suppliers` com CNPJ/CPF, contato, condições padrão (prazo, forma de pagamento preferida)
- Histórico de compras/pagamentos por fornecedor

**Contas a Pagar (AP):**
- `accounts_payable` com fornecedor, valor, vencimento, conta contábil, company/unit, descrição, anexo (NF/boleto/comprovante)
- **Workflow de aprovação configurável por empresa** (ADR 0034): ex: até R$500 auto-aprovado; R$500-R$5000 gerente; >R$5000 gerente+diretor
- Status: `draft` → `pending_approval` → `approved` → `scheduled` → `paid` → `reconciled`
- Pagamento via Asaas (transferência/PIX via chave do tenant), manual (registrar pagamento externo), ou lote

**Contas a Receber (AR) avulso:**
- `accounts_receivable` para recebimentos que não são contratos (aluguel recebido, venda esporádica, reembolso)
- Geração de boleto/PIX via Asaas
- Integração com `invoices` existente (contrato) — mesmo dashboard de recebíveis

**OCR de boleto (provider abstrato) + WhatsApp inbound:**
- Upload por drag-and-drop, câmera PWA ou **WhatsApp inbound (registrando handler no hub do Sprint 13, ADR 0051)** — fornecedor/cliente manda PDF no WhatsApp do tenant, sistema OCR'a, cria AP em draft, notifica financeiro
- **Interface abstrata** `OCRProvider` com múltiplas implementações; cliente escolhe via config do tenant
- Providers suportados:
  - **OCR.space** (default global) — API HTTP, tier gratuito 25k/mês, Pro US$ 30/mês
  - **Google Vision API** — melhor qualidade pt-BR, ~US$ 1,50/1000 imagens
  - **AWS Textract** — ótimo para documentos estruturados, ~US$ 1,50/1000 páginas
  - **Microsoft Azure Computer Vision** — alternativa em ecossistema Microsoft
  - **Tesseract self-hosted** — open source, zero custo recorrente, qualidade menor (fallback gratuito)
- Config por tenant em `tenant_settings.ocr_provider` + credentials próprias criptografadas (permite cliente grande usar conta corporativa Google/AWS)
- Fallback em cadeia configurável: se provider primário falha (rate limit, erro), tenta próximo automaticamente
- Parser **determinístico** da linha digitável 47 dígitos FEBRABAN → valor, vencimento, cedente, nosso número (funciona com qualquer provider OCR que retorne texto razoável)
- Preenche AP em draft; operador confirma/edita
- Dashboard de saúde do OCR por tenant: % acerto, providers usados, fallbacks acionados

**NF-e · Inbox unificada (ADR 0056):**
- Tela central **`/app/financeiro/nfe`** concentra os 4 métodos de ingestão na mesma lista; cada linha em `nfe_received` mostra badge de origem (`auto`/`chave`/`upload`/`manual`)
- Filtros: status, origem, período, fornecedor, empresa
- Ações primárias no topo da inbox: **[🔎 Por chave]**, **[📄 Upload XML]**, **[✍ Entrada manual sem NF]**
- **No MVP (Sprint 15):** ativos **Upload XML** e **Entrada manual**; botão "Por chave" presente mas **desabilitado com tooltip** "disponível a partir do Sprint 17 quando provider estiver configurado"
- **Upload XML:** parser extrai emitente (CNPJ + razão social + endereço) → **busca em `persons` pelo CNPJ**; se não existe, cria `persons` com kind=pj + cria `suppliers` linkando; se já existe como persons mas sem papel supplier, adiciona só registro em `suppliers`. Nunca duplica. Cria linha em `nfe_received` com `source='upload_xml'` e AP draft linkada.
- **Entrada manual sem NF:** modal com campos mínimos (fornecedor via PersonPicker, valor, vencimento, categoria do plano de contas, descrição) → cria direto `accounts_payable` com flag `no_invoice=true`; **não** cria linha em `nfe_received` (não é nota fiscal)
- Itens da NF (para integração futura com estoque Sprint 24) guardados em `nfe_received.raw_payload` como JSON
- Valida chave de acesso (44 dígitos) — duplicatas bloqueadas via unique global
- **Configuração:** `/app/settings/financeiro/nfe` mostra toggle "Download automático" com estado "aguardando configuração (Sprint 17)"; os 3 métodos manuais aparecem como "sempre ativos" sem toggle
- Automação SEFAZ + download por chave vão no Sprint 17 (pluga na mesma inbox)

**Gerais:**
- Relatórios: AP vencidos, AR vencidos, top 10 fornecedores, aging (0-30/30-60/60-90/>90 dias)
- Audit log completo (regra 5) em toda criação/aprovação/pagamento
- Permission `financeiro.ap.*`, `financeiro.ar.*`, `financeiro.approve`, `financeiro.pay`
- Teste E2E: subir PDF boleto → OCR → AP draft → gerente aprova → pagamento → conciliação
- Teste E2E: subir XML NF-e → fornecedor criado → AP criada → fluxo até pago
- Seed: 20 fornecedores + 10 APs em estados variados + 5 ARs avulsas

## Dependências

- Sprint 04 (Asaas + `invoices` existente)
- Sprint 14 (`cost_entries` vira fonte alternativa ou migra para AP — decidir no sprint)
- Sprint 01b (consent/audit/workflow de aprovação reusa RBAC)
- Sprint 01a (`persons` central via [ADR 0047](../decisions/0047-cadastro-central-persons.md) — `suppliers.person_id` FK)

## Decisões tomadas / ADRs esperados

- **ADR 0033 (esperado)** — Plano de contas hierárquico: `chart_of_accounts` com `parent_id` self-referencing + seed brasileiro padrão; cada lançamento obrigatoriamente vinculado a 1 conta folha (não pode vincular a conta agregadora).
- **ADR 0034 (esperado)** — Workflow AP configurável: `approval_rules` por tenant (ou por empresa) com faixas de valor + aprovadores em série ou paralelo. Estado da AP avança conforme cada aprovação chega; audit completo de quem aprovou/rejeitou.
- **ADR 0035 (accepted)** — **OCR de boleto: interface abstrata configurável pelo admin do tenant**. OCR.space é o provider default (tier gratuito 25k/mês), mas o admin pode trocar por Google Vision, AWS Textract, Azure Computer Vision ou Tesseract self-hosted via `/app/settings/financeiro/ocr`. Credentials criptografadas por tenant. Fallback em cadeia configurável. Parser FEBRABAN é pós-OCR e independente de provider. Fallback final: operador digita manual se todos os providers falharem.
- **Relação com `cost_entries` do Sprint 14:** decidir no sprint se `cost_entries` vira legado ou migra para `accounts_payable` (simplificação). Recomendação: AP é fonte primária; `cost_entries` fica como lançamento rápido para despesas sem fornecedor formal.

## Módulos entregues

- Plano de contas hierárquico
- Cadastro de fornecedores + histórico
- Contas a pagar com workflow multi-aprovador
- Contas a receber avulso (separado de contratos)
- OCR de boleto via OCR.space + parser FEBRABAN
- Upload XML NF-e + parser + criação automática de AP
- Relatórios AP/AR + aging

## Rotas Next.js

- `/app/financeiro/plano-contas` — CRUD hierárquico
- `/app/financeiro/fornecedores` — lista + CRUD + histórico
- `/app/financeiro/contas-pagar` — lista com filtros (vencimento, status, fornecedor)
- `/app/financeiro/contas-pagar/new` — criação manual
- `/app/financeiro/contas-pagar/[id]` — detalhe + aprovação/pagamento
- `/app/financeiro/contas-pagar/ocr` — upload boleto PDF/imagem
- `/app/financeiro/nfe` — **Inbox unificada** (ADR 0056): lista de `nfe_received` + ações [Por chave disabled / Upload XML / Entrada manual]
- `/app/financeiro/nfe/[id]` — detalhe da NF recebida + botão "Converter em AP" (ou "Ver AP")
- `/app/settings/financeiro/nfe` — toggle download automático + métodos manuais listados
- `/app/financeiro/contas-receber` — AR avulso (não-contrato)
- `/app/financeiro/aging` — aging report
- `/app/settings/financeiro/aprovacao` — configurar regras de workflow
- `/app/settings/financeiro/ocr` — **admin do tenant configura provider OCR**: escolhe na lista (OCR.space/Google Vision/AWS Textract/Azure/Tesseract), cola API key, define provider de fallback, testa com boleto de exemplo e vê preview do resultado
- `/app/settings/financeiro/naturezas` (ADR 0061) — CRUD de `tax_natures`: lista naturezas globais (10 curadas, read-only com botão "Desativar para meu tenant") + CRUD das custom do tenant; modal de edição mostra `retentions jsonb` em formato amigável (checkbox por tributo + campo rate + threshold); preview "aplicado em AP de R$ 1.000" mostra retenções calculadas para validar configuração

## Server Actions + API Routes

Server Actions:
- `createChartAccount`, `moveChartAccount(id, newParentId)`
- `createSupplier({ personId, ...specificFields })` — linka persons existente (obrigatório); UI `/app/financeiro/fornecedores/new` usa `<PersonPicker>` para buscar/criar persons antes
- `updateSupplier(id, patch)` — só campos específicos; identidade edita em `/app/pessoas/[id]`
- `createAP(input)` (draft), `submitForApproval(apId)`, `approveAP(apId)`, `rejectAP(apId, reason)`
- `registerManualPayment(apId, method, paidAt, reference)`, `payViaAsaas(apId)`
- `createAR(input)`, `generateBoletoAR(arId)`
- `processOcrBoleto(fileUpload)` — chama OCR.space, parseia linha digitável, retorna dados para preencher AP
- `uploadNfeXml(xmlContent)` — parser, cria/atualiza supplier via persons, cria linha em `nfe_received` com `source='upload_xml'` e AP draft linkada (ADR 0056)
- `createApManual(input)` — entrada manual sem NF; cria `accounts_payable` com `no_invoice=true`; **não** cria linha em `nfe_received`
- `convertNfeToAp(nfeReceivedId)` — recebe linha da inbox e cria AP vinculada (para NFs em status `new` ou `parsed`)
- `discardNfe(nfeReceivedId, reason)` — marca `status='rejected'` com motivo (ex: duplicata, cancelada pelo emitente)
- `toggleAutoDownload(companyId, enabled)` — placeholder no Sprint 15 (retorna erro "configure no Sprint 17"); funcional no Sprint 17

API Routes:
- `POST /api/financeiro/ocr/boleto` — recebe arquivo, chama OCR.space, retorna JSON estruturado
- `POST /api/financeiro/nfe/upload` — recebe XML, parseia, cria linha em `nfe_received` + AP draft

## Schemas Drizzle (esperado)

Em `packages/db/schema/erp-financeiro.ts`:

- `chart_of_accounts` — `id`, `tenant_id`, `code text`, `name text`, `kind` enum (`ativo`, `passivo`, `receita`, `despesa`, `custo`), `parent_id uuid nullable`, `is_leaf bool`, `active`
- `suppliers` — `id`, `tenant_id`, `person_id uuid not null` (FK `persons` do Sprint 01a — fornece kind, document, name, email, phone, address), `company_id nullable` (para fornecedores específicos de uma company da rede), `default_payment_method text nullable`, `default_payment_term_days int nullable`, `bank_account jsonb nullable` (chave PIX, banco/agência/conta), `notes text`, `archived_at`. Unique `(tenant_id, person_id)`. Identidade vem via JOIN com `persons`; view `v_suppliers_full` materializa leitura.
- `approval_rules` — `id`, `tenant_id`, `scope` enum (`ap`, `ar`, `both`), `min_amount_cents`, `max_amount_cents nullable`, `required_approvers jsonb` (array ordenada de roles ou user_ids), `company_id nullable` (regras específicas por empresa), `active`
- `accounts_payable` — `id`, `tenant_id`, `company_id`, `supplier_id nullable`, `chart_account_id`, `amount_cents` (bruto), **`tax_nature_id uuid nullable` fk `tax_natures`** (ADR 0061), **`retention_total_cents bigint default 0`** (soma de retenções calculadas), **`net_amount_cents bigint`** (valor líquido a pagar = bruto - retenções), `issue_date`, `due_date`, `description`, `doc_number text nullable` (NF/boleto), `doc_key text nullable` (chave NF-e 44 dígitos, unique), `nfe_received_id uuid nullable` (FK `nfe_received` quando AP originou de inbox NF-e), `no_invoice bool default false` (true = entrada manual sem nota fiscal), `status` enum (`draft`, `pending_approval`, `approved`, `rejected`, `scheduled`, `paid`, `cancelled`, `reconciled`), `approval_trace jsonb`, `paid_at nullable`, `paid_amount_cents nullable`, `payment_method text nullable`, `asaas_transfer_id nullable`, `attachment_storage_path nullable`, `source` enum (`manual`, `ocr_boleto`, `nfe_upload`, `nfe_manual_key`, `nfe_sefaz`), `source_metadata jsonb`, `created_by_user_id`, `created_at`
- `nfe_received` (ADR 0056, compartilhada com Sprints 17/36; ampliada pelas ADRs 0057/0060) — `id`, `tenant_id`, `company_id`, `chave text` (44 dígitos; unique global), `source` enum (`auto_sefaz`, `manual_key`, `upload_xml`), `xml_storage_path text nullable`, `emitter_cnpj text nullable`, `emitter_person_id uuid nullable` fk persons, `supplier_id uuid nullable` fk suppliers, `amount_cents bigint nullable`, `issue_date date nullable`, `received_at timestamptz default now()`, `fetched_by_user_id uuid nullable`, `fetch_duration_ms int nullable`, `ap_id uuid nullable` fk accounts_payable, `status` enum (`new`, `parsed`, `ap_created`, `duplicate`, `rejected`), `error_reason text nullable`, `raw_payload jsonb nullable`, **`manifestation_status text default 'pending'`** (ADR 0057 — enum `pending`/`ciencia`/`confirmada`/`desconhecida`/`nao_realizada`/`expired`/`not_applicable`), **`manifestation_protocol text nullable`**, **`manifestation_at timestamptz nullable`**, **`manifestation_deadline date nullable`**, **`manifestation_by_user_id uuid nullable`**, **`manifestation_mode text nullable`** (`automatic`/`manual`), **`manifestation_justification text nullable`**, **`manifestation_attempts int default 0`**, **`manifestation_last_error text nullable`**, **`finality text default 'normal'`** (ADR 0060 — `normal`/`complementar`/`ajuste`/`devolucao`; extraído de `finNFe` do XML), **`cfop_primary text nullable`** (CFOP predominante), **`related_nfe_id uuid nullable` fk nfe_received** (link para NF original via `refNFe`), **`related_chave text nullable`** (cache da chave), **`is_self_issued_entry bool default false`** (NF-e de entrada emitida pelo próprio tenant via Sprint 36), **`self_issue_emission_id uuid nullable` fk fiscal_emissions**, **`inbound_direction text default 'purchase'`** (enum `purchase`/`sales_return`/`complement_received`/`adjustment_received`/`self_entry`). Check: `source='auto_sefaz' → xml_storage_path IS NOT NULL`. **Trigger:** marca `manifestation_status='not_applicable'` na inserção se `company.cnpj IS NULL` (gate por CNPJ).
- `nfe_returns` (ADR 0058) — `id`, `tenant_id`, `company_id`, `nfe_received_id` fk, `kind` enum (`total`, `partial`), `items jsonb nullable` (shape `[{item_index, quantity_returned, value_cents}]`), `return_amount_cents`, `reason_category` enum (`defeito`, `divergencia_quantidade`, `divergencia_especificacao`, `atraso`, `cancelamento`, `outro`), `reason_description text` (min 20 chars), `status` enum (`draft`, `awaiting_external_emission`, `emitted`, `confirmed_by_supplier`, `rejected_by_supplier`, `cancelled`) default `draft`, `external_chave text nullable` (chave da NF-e de devolução emitida), `external_xml_storage_path text nullable`, `external_issue_date date nullable`, `emitted_at timestamptz nullable`, `emission_mode text nullable` (`external_import`/`focus_nfe`), `created_by_user_id`, timestamps.
- `fiscal_emissions` (ADR 0059 — preparação de schema; UI no Sprint 36) — `id`, `tenant_id`, `company_id`, `document_kind text` (`nfse`/`nfe_product`/`nfe_return`/`nfe_transfer`/`nfe_conserto_out`/`nfe_conserto_return`/`nfce`/`nfe_self_entry`), `chave text unique nullable`, `serie int nullable`, `number int nullable`, `status text` (`draft`/`processing`/`emitted`/`rejected`/`cancelled`/`inutilizada`), `source_ref_type text nullable`, `source_ref_id uuid nullable`, `provider text default 'focus_nfe'`, `provider_payload_sent jsonb nullable`, `provider_response jsonb nullable`, `xml_storage_path nullable`, `pdf_storage_path nullable`, `emitted_at nullable`, `cancelled_at nullable`, `cancel_reason text nullable`, `total_amount_cents bigint nullable`, `issued_by_user_id`, timestamps.
- `fiscal_events` (ADR 0059) — `id`, `tenant_id`, `emission_id nullable` fk, `kind` enum (`cancel`/`cce`/`inutilizacao`), `protocol nullable`, `justification text` (min 15 chars), `payload_sent jsonb`, `provider_response jsonb`, `status` (`pending`/`accepted`/`rejected`), `issued_by_user_id`, timestamps.
- `fiscal_numbering_sequences` (ADR 0059) — `company_id`, `document_kind`, `serie int default 1`, `last_number int default 0`, `updated_at`. PK `(company_id, document_kind, serie)`.
- `tax_natures` (ADR 0061) — `id`, `tenant_id nullable` (null = global curado LogiFit), `code text`, `label`, `applies_to` enum (`ap`, `professional_contract`, `both`), `retentions jsonb` (array de regras: `{tax, rate?, rate_table?, threshold_cents?, cap_cents?, condition?}`), `regulatory_reference text`, `active bool default true`, `archived_at nullable`. Unique `(tenant_id, code) NULLS NOT DISTINCT`. Global: tenant herda automaticamente; admin pode criar custom ou desativar global para seu tenant.
- `tax_retentions` (ADR 0061) — `id`, `tenant_id`, `source_type` enum (`ap`, `commission_entry`), `source_id uuid`, `tax_nature_id` fk, `tax text` (`pis`/`cofins`/`csll`/`irrf`/`inss`/`iss`), `base_cents bigint`, `rate_applied numeric`, `amount_cents bigint`, `should_withhold bool`, `guide_status text default 'pending'` (`pending`/`paid`/`reconciled`), `guide_reference text nullable` (número DARF/GPS colado pelo operador), `paid_at nullable`, `calculated_at`. Unique `(source_type, source_id, tax)`.
- `company_settings` (ou colunas em `companies`) — `nfe_auto_download_enabled bool default false`, `nfe_provider text nullable`, `nfe_provider_credentials jsonb nullable` (criptografado), `nfe_last_sync_at timestamptz nullable`, `nfe_last_sync_count int default 0`, **`nfe_manifestation_enabled bool default true`** (ADR 0057; `false` automaticamente quando `company.cnpj IS NULL`), **`nfe_auto_ciencia_enabled bool default true`** (ADR 0057: **default ON** por decisão do usuário — dispara evento 210210 automaticamente ao criar linha em `nfe_received`), **`nfe_manifestation_deadline_days int default 180`**
- `accounts_receivable` — similar a AP mas pro lado recebimento; opcionalmente vinculada a `invoices` (contratos) ou independente
- `ap_ar_payments` — pagamentos individuais (uma AP pode ter múltiplos pagamentos parciais)

**RLS:** tenant_id + scope por company + permission. Chave NF-e unique global para evitar duplicata entre tenants.

## Eventos de domínio emitidos

- `ap.created`, `ap.submitted`, `ap.approved`, `ap.rejected`, `ap.paid`, `ap.reconciled`
- `ar.created`, `ar.boleto_issued`, `ar.received`
- `supplier.created`, `supplier.updated`
- `ocr.boleto_processed` (com accuracy)
- `nfe.received_via_upload`
- `nfe.converted_to_ap` — inbox virou AP
- `nfe.discarded` — inbox descartada (com reason)
- `chart_account.created`

## Commit (checklist)

- [ ] Schema Drizzle: `chart_of_accounts`, `suppliers`, `approval_rules`, `accounts_payable`, `accounts_receivable`, `ap_ar_payments`, `nfe_received` (ADRs 0056 + 0057 + 0060), `nfe_returns` (ADR 0058), `fiscal_emissions` + `fiscal_events` + `fiscal_numbering_sequences` (ADR 0059 — preparação), `tax_natures` + `tax_retentions` (ADR 0061), campos `nfe_*` em `company_settings`/`companies`
- [ ] Seed global `tax_natures` com 10 naturezas comuns (ADR 0061): `servico_prestado_pj_geral`, `servico_prestado_pj_saude`, `autonomo_rpa_pf`, `aluguel_pj`, `aluguel_pf`, `software_saas_pj`, `comissao_autonomo_pf`, `servico_transporte_pj`, `utilidade_publica`, `simples_nacional_anexo_iii`
- [ ] Calculadora `packages/ai/fiscal/tax-calculator.ts` — funções puras `calculateRetentions(base_cents, natureId, tenantCtx): Array<Retention>`; suporte a `rate_table` (IRRF progressivo 2026), `cap_cents` (teto INSS 2026), `threshold_cents` (mínimo para reter), `condition` (regra por UF/tomador PJ)
- [ ] Testes unit da calculadora: 20+ casos cobrindo todas as 10 naturezas + edge cases (valor abaixo do threshold, teto INSS, IRRF tabela progressiva em faixas distintas)
- [ ] UI AP: select `Natureza tributária` em `/app/financeiro/contas-pagar/new` + `[id]`; ao escolher, mostra preview "retenções: PIS R$X + COFINS R$Y + ... = líquido R$Z"; grava linhas em `tax_retentions`; coluna `net_amount_cents` atualizada
- [ ] UI admin `/app/settings/financeiro/naturezas` — lista naturezas globais (read-only) + custom do tenant (CRUD); botão "Desativar para meu tenant" na global
- [ ] **Job anual** `tax-tables-annual-update`: LogiFit admin atualiza tabela IRRF + teto INSS + salário mínimo quando RFB publica; versiona seed global; alerta admins dos tenants com link para revisar configs
- [ ] Trigger de inserção em `nfe_received`: marcar `manifestation_status='not_applicable'` quando `company.cnpj IS NULL` (gate por CNPJ, ADR 0057)
- [ ] Parser NF-e estendido (ADR 0060): extrai `finNFe → finality`, CFOP do 1º item → `cfop_primary`, `refNFe → related_chave` + resolve `related_nfe_id` se NF original já existe, detecta `emit.CNPJ == dest.CNPJ → is_self_issued_entry=true`, determina `inbound_direction` por CFOP + finalidade
- [ ] Coluna `nfse_chave text nullable` adicionada a `invoices` (Sprint 04) — ADR 0059 linka invoice → emissão fiscal
- [ ] Migration: seed plano de contas brasileiro simplificado (~60 contas)
- [ ] RLS + audit completo
- [ ] Zod schemas em `packages/types/erp-financeiro.ts`
- [ ] Interface abstrata `packages/ai/ocr/provider.ts` com contrato comum (`extractText`, `extractStructured`)
- [ ] Adapters de provider em `packages/ai/ocr/providers/`: `ocrspace.ts` (default), `googlevision.ts`, `awstextract.ts`, `azure.ts`, `tesseract.ts` (self-hosted via child process ou API local)
- [ ] Orquestrador `packages/ai/ocr/orchestrator.ts` com fallback em cadeia configurável por tenant
- [ ] Schema `tenant_ocr_settings` — tenant_id, provider_primary, provider_fallback nullable, credentials_encrypted (JSONB por provider), active
- [ ] UI `/app/settings/financeiro/ocr` com seletor + form de credentials por provider + botão "testar com boleto de exemplo" + preview
- [ ] Parser linha digitável FEBRABAN em `packages/db/erp-financeiro/febraban.ts` (47 dígitos — valor, vencimento, cedente, nosso número)
- [ ] Parser XML NF-e em `packages/db/erp-financeiro/nfe-parser.ts` (schema nacional, extrai emitente, itens, valor, chave)
- [ ] Server Actions + API Routes
- [ ] Workflow engine em `packages/db/erp-financeiro/approval.ts` (avalia `approval_rules` + decide próximo aprovador)
- [ ] UI plano de contas (tree view)
- [ ] UI fornecedores com histórico
- [ ] UI AP com kanban (draft/pending/approved/paid) + detalhe
- [ ] UI upload OCR de boleto (drag-drop)
- [ ] **Registrar handler `boleto-upload`** no hub inbound do Sprint 13 (ADR 0051): recebe anexo classificado como boleto, executa OCR + cria AP em draft automaticamente, notifica financeiro via resposta WhatsApp "Recebi boleto de R$ X, encaminhado"
- [ ] **UI inbox unificada `/app/financeiro/nfe`** (ADR 0056): lista `nfe_received` com badges de origem + filtros + ações [Por chave disabled / Upload XML / Entrada manual]
- [ ] Modal de entrada manual (sem NF) — `createApManual` com PersonPicker + campos mínimos
- [ ] UI `/app/settings/financeiro/nfe` — toggle download automático (disabled no Sprint 15, funcional no Sprint 17) + listagem dos métodos manuais como "sempre ativos"
- [ ] Interface `NfeFetcher` em `packages/ai/nfe/fetcher.ts` (esqueleto; impls concretas nascem no Sprint 17)
- [ ] Job pagamento em lote (gerente seleciona N APs approved e paga de uma vez)
- [ ] Relatórios aging + top fornecedores
- [ ] Integração Asaas para transferência/PIX (reusa wrapper Sprint 04)
- [ ] Widget "contas a pagar vencendo" no dashboard do gerente (Sprint 07 estendido)
- [ ] Permissions `financeiro.ap.read/write`, `financeiro.ar.read/write`, `financeiro.approve`, `financeiro.pay`
- [ ] Seed: 20 fornecedores + 10 APs + 5 ARs + 3 approval_rules
- [ ] Testes unit: parser FEBRABAN (10 casos), parser NF-e, workflow de aprovação
- [ ] Testes E2E: OCR → AP draft → aprovação → pagamento; NF-e upload → fornecedor → AP
- [ ] Feature flag `erp_financeiro_v1`
- [ ] ADRs 0033, 0034, 0035 publicados

## Stretch

- [ ] WhatsApp inbound de boleto: paciente/fornecedor manda PDF, dispara OCR automaticamente, cria AP draft
- [ ] Regras inteligentes: se fornecedor já existe e histórico > 5 pagamentos, pular aprovação
- [ ] OCR de comprovantes de pagamento (conciliar manualmente)
- [ ] Importação em lote de APs via CSV

## Log

- —

## Definition of Done

- [ ] Feature flag `erp_financeiro_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] OCR.space integrado e funcionando em sandbox
- [ ] Parser NF-e valida contra XSD nacional
- [ ] Workflow de aprovação auditado nos 4 cenários canônicos
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 15 → `done`
- [ ] ADRs 0033, 0034, 0035 publicados

## Retro

- —
