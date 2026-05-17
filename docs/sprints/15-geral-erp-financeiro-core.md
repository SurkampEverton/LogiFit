# Sprint 15 — Geral · ERP Financeiro Core (AP + AR + Plano de Contas + OCR boleto + NF-e XML)

- **Área:** geral
- **Início:** 2026-05-14
- **Fim planejado:** +4 semanas — **⚠️ candidato à quebra em 15a (AP/AR core + plano contas + workflow aprovação) + 15b (OCR boleto multi-provider + NF-e XML + fornecedores import)** se estourar 3 semanas (regra 9). **Decisão tomada na abertura (2026-05-14):** quebrar em 15a (core MVP — em execução agora) + 15b (OCR + NF-e + retenções tributárias ADR 0061 + manifestação destinatário ADR 0057 + auto-emissão ADR 0060). Schemas pré-cabeados para 15b (taxNatureId/retentionTotalCents/netAmountCents/nfeReceivedId/noInvoice/source enum já em `accounts_payable`) sem precisar nova migration.
- **Status:** done (15a core; 15b OCR/NF-e/retenções fica em sprint futuro)
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
- [ ] **Pesquisa global** (ADR 0062): trigger `search_index_sync()` em `accounts_payable`, `accounts_receivable`, `suppliers` + `nfe_received` com kind=`ap`/`ar`/`supplier`/`nfe_received`, `required_permission='financeiro.ap.read'|'financeiro.ar.read'|'financeiro.nfe.read'`; label=`doc_number` + supplier name; subtitle=valor + vencimento + status; URL de navegação direta
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

### 2026-05-14 — Faixa A iniciada (25%)

**Decisão de quebra em 15a (core MVP) + 15b (OCR/NF-e/retenções):**
- 15a: plano de contas hierárquico + suppliers + AP core (workflow + payment manual) + AR avulso + aging — escopo cobrável em ~2 semanas
- 15b (seguinte): OCR multi-provider (ADR 0035), NF-e inbox unificada (ADR 0056), retenções tributárias (ADR 0061), manifestação destinatário (ADR 0057), self-issued NF-e entrada (ADR 0060)
- Schemas de AP **pré-cabeados** para 15b (`taxNatureId nullable` + `retentionTotalCents default 0` + `netAmountCents = amount - retention` via check + `nfeReceivedId nullable` + `noInvoice bool` + `source enum` com valores `nfe_*`/`ocr_boleto`) — Faixa B/C/D de 15b não exigem migration nova

**Entregues:**
- `packages/db/src/schema/erp-financeiro.ts` — 6 tabelas: `chart_of_accounts` (hierárquico self-FK + `is_leaf bool` + unique `(tenant, code)`) + `suppliers` (FK persons ADR 0047 + bank_account jsonb + unique `(tenant, person)`) + `approval_rules` (DSL declarativa min/max + required_approvers jsonb + check `max ≥ min`) + `accounts_payable` (state machine 8 estados + approval_trace jsonb + 4 checks: amount positive, net consistent, retention non-negative, due ≥ issue + unique global doc_key NF-e) + `accounts_receivable` (separado de invoices contratos Sprint 04 + 2 checks) + `ap_ar_payments` (append-only via ausência policy + source_type discriminator 'ap'/'ar')
- `packages/db/src/policies/0034_erp_financeiro_rls.sql` — RLS tenant-scoped em todas as 6 tabelas + FORCE; SELECT/INSERT/UPDATE em 5 tabelas; `ap_ar_payments` sem UPDATE/DELETE policy (append-only)
- Migration `0021_woozy_nocturne.sql` aplicada
- `packages/db/tests/erp-financeiro-rls.test.ts` — **16 tests verdes** cobrindo: unique `(tenant, code)` rejeita duplicata + coexiste em outro tenant + isolation per-tenant; supplier unique `(tenant, person)`; approval_rules check `max < min` rejeitado; AP check `amount=0` rejeitado, `net ≠ amount - retention` rejeitado, `due < issue` rejeitado + AP válida com retenção consistente; doc_key duplicado global rejeitado (cross-tenant); AR válida + AR `due < issue` rejeitada; ap_ar_payments check source_type inválido + append-only UPDATE/DELETE bloqueados (sem policy = 0 rows afetadas).
- `packages/db/src/erp-financeiro/approval.ts` — workflow engine ADR 0034:
  - `pickApprovalRule(amountCents, companyId, rules)` — rule de menor `max_amount_cents` que engloba valor; prioriza company-specific antes de global
  - `decideNextState({amount, company, rules, trace})` — máquina de estado retorna `approved` (3 razões) / `pending_approval` (próximo approver) / `rejected`
  - `canUserApprove({userId, roles, ...})` — valida que user é o próximo aprovador antes de Server Action `approveAP` aceitar
  - DSL Zod: `ApproverSchema` (role OU userId) + `RequiredApproversSchema` (series/parallel + max 10 approvers) + `ApprovalTraceEntrySchema`
- `packages/db/src/erp-financeiro/approval.test.ts` — **21 tests verdes** cobrindo: pickApprovalRule (menor max + company-specific + sem rule + max=NULL) + decideNextState (sem rule → no_rule_required + auto_approved + series next + series all_done + parallel remaining + parallel done + rejected) + canUserApprove (next approver matching role + user_id + rejeita outro user + rejeita estado approved)
- `packages/db/package.json` — exports `./erp-financeiro` apontando para `src/erp-financeiro/index.ts`
- **298 testes Vitest verdes total** (era 261 → +37 Sprint 15: 16 RLS + 21 workflow)
- Typecheck clean

**Próximo (Faixa B):**
- B.2 seed plano de contas brasileiro simplificado (~60 contas) + Server Actions chart
- B.3 Server Actions suppliers + AP (create/submit/approve/reject/pay) + AR (create + manual receive)

### 2026-05-15 — Sprint 15a core MVP done (100%)

**Faixa B entregue:**

- **`packages/db/scripts/seed-plano-contas.ts`** (ADR 0033) — popula ~67 contas brasileiras canônicas em cada tenant: 12 agregadoras (5 raízes + 7 subgrupos) + 55 folhas operacionais adaptadas a academia/clínica fisio/nutri. Pass 1 INSERT idempotente via `ON CONFLICT (tenant_id, code) DO NOTHING`; Pass 2 resolve `parent_id` via lookup por `code`. Bonus: cria 3 `approval_rules` canônicas (Auto até R$ 500 / Gerente até R$ 5.000 / Gerente+Diretor acima). Comando: `pnpm --filter @repo/db db:seed:plano-contas`.
- **`apps/web/app/app/financeiro/plano-contas/actions.ts`** — 5 Server Actions wrapped: `createChartAccount` (valida parent existe + kind herda + marca pai automaticamente como não-folha), `listChartAccounts` (filtro kind + includeArchived), `listLeafAccounts` (para select de AP/AR), `archiveChartAccount` (bloqueia se houver filhos ativos OU lançamentos AP/AR), `moveChartAccount` (valida kind do novo pai + bloqueia ciclo trivial).
- **`apps/web/app/app/financeiro/fornecedores/actions.ts`** — 5 Server Actions: `createSupplier` (valida persons existe no tenant), `updateSupplier` (só campos específicos do supplier — identidade edita em `/app/pessoas/[id]` ADR 0047), `listSuppliers` (filtros + ILIKE name/document), `getSupplier` (com histórico AP últimas 20), `archiveSupplier` (bloqueia se houver APs em aberto).
- **`apps/web/app/app/financeiro/contas-pagar/actions.ts`** — 7 Server Actions consumindo workflow engine `approval.ts`: `createAP` (valida chart é folha + ativa + due ≥ issue), `submitForApproval` (passa draft→pending E roda `decideNextState` — rule sem approvers vira approved direto), `approveAP` (chama `canUserApprove` antes; adiciona trace; transiciona), `rejectAP` (registra rejeição no trace), `cancelAP` (estados ≤ scheduled), `registerManualPayment` (insere `ap_ar_payments` + soma agregada; status vira `paid` quando total ≥ netAmount, senão `scheduled`), `listAP` (filtros status/supplier/company/due), `getAP` (com payments + trace).
- **`apps/web/app/app/financeiro/contas-receber/actions.ts`** — 6 Server Actions: `createAR`, `markARIssued`, `registerARReceived` (similar a registerManualPayment — soma agregada via `ap_ar_payments` source_type='ar'), `cancelAR`, `listAR`, `getAR`.

**Faixa C entregue (9 rotas Next.js):**

- **`/app/financeiro/plano-contas`** — tree view server-rendered agrupado por kind (5 cards ativo/passivo/receita/despesa/custo) com dots coloridos e indentação por profundidade do code (depth = count de `.`); badge "grupo" em não-folhas; folhas em fonte normal.
- **`/app/financeiro/plano-contas/new`** — form criação com selector de kind, pai filtrado por kind (cascading), code regex `^[0-9]+(\.[0-9]+)*$`, checkbox isLeaf.
- **`/app/financeiro/fornecedores`** — lista tabular com nome, doc formatado (CPF/CNPJ), contato, payment method default badge, prazo D+N.
- **`/app/financeiro/fornecedores/new`** — form com busca de pessoa existente + select grandes (size=8), dados bancários opcionais (PIX + banco/agência/conta), pgto padrão + prazo.
- **`/app/financeiro/fornecedores/[id]`** — detalhe com 3 KPIs (Total pago / Em aberto / Notas) + dados + histórico AP últimas 30 com badges de status color-coded.
- **`/app/financeiro/contas-pagar`** — lista filtrável (status/from/to) com 2 KPIs (A pagar / Em atraso color-coded vermelho), tabela ordenada por dueDate com row em vermelho+bold quando overdue.
- **`/app/financeiro/contas-pagar/new`** — wizard com companies + suppliers + leaf accounts (filtrado a despesa/custo/passivo); ao selecionar supplier, auto-preenche dueDate via defaultPaymentTermDays; opção "submeter imediatamente" chama `submitForApproval` em seguida.
- **`/app/financeiro/contas-pagar/[id]`** — detalhe com 4 KPIs (Bruto/Líquido/Pago/A pagar) + dados + histórico approval_trace timeline color-coded por action (submitted azul / approved verde / rejected vermelho) + `<APActions>` client-side com dialogs inline para Aprovar (com comentário), Rejeitar (com motivo min 5 chars), Cancelar, Registrar Pagamento (com valor/data/método/referência); botões aparecem condicionalmente baseado em status.
- **`/app/financeiro/contas-receber`** — lista filtrável similar a AP com 2 KPIs (A receber / Recebido color-coded verde).
- **`/app/financeiro/contas-receber/new`** — wizard com payer search + leaf accounts filtrado a receita/ativo; opção "marcar como emitida imediatamente".
- **`/app/financeiro/contas-receber/[id]`** — detalhe com 3 KPIs + dados + `<ARActions>` client-side (Marcar emitida / Registrar recebimento / Cancelar).
- **`/app/financeiro/aging`** — relatório AP+AR distribuído em 5 buckets (A vencer / 1-30 / 31-60 / 61-90 / 90+) com bar charts horizontais color-coded; 2 seções (AP e AR) com totais por seção.
- **`/app/financeiro`** (hub) — atualizado com 8 cards nav: Plano de contas, Fornecedores, Contas a pagar, Contas a receber, Aging + Custos, DRE, Previsão (Sprint 14).

**Faixa D entregue:**

- **`docs/decisions/0033-plano-contas-hierarquico-erp-financeiro.md`** Accepted — plano hierárquico self-FK + is_leaf + kind herda do pai + seed brasileiro simplificado ~67 contas + alternativas rejeitadas (ltree, nested set, achatado).
- **`docs/decisions/0034-workflow-aprovacao-ap-declarativo.md`** Accepted — `approval_rules` DSL JSON (`mode series/parallel` + `approvers role|userId` + `min/max amount` + `companyId opcional`); `approval_trace jsonb` append-only no AP; engine puro `pickApprovalRule`/`decideNextState`/`canUserApprove` com 21 unit tests; alternativas rejeitadas (Temporal, stored procs, hardcode).
- **`packages/db/scripts/seed-erp-financeiro.ts`** — 20 fornecedores PJ típicos brasileiros (imobiliária, energia, telefonia, Google Cloud, suplementos atacado, contabilidade, advocacia, Sabesp, Enel, gráfica, uniformes, Asaas, calibração, eventos, brindes — com CNPJs algoritmicamente válidos); 10 APs por tenant em estados variados (3 paid + 2 pending_approval + 2 approved + 1 rejected + 1 cancelled + 1 draft) com trace sintético; 5 ARs avulsos (2 received + 2 issued + 1 draft); pagamentos `ap_ar_payments` populados pra APs/ARs concluídas. **8 tenants total = 160 fornecedores + 80 APs + 40 ARs**. Comando: `pnpm --filter @repo/db db:seed:erp-financeiro` (idempotente via count check).
- Typecheck monorepo verde.
- **298 testes Vitest verdes** (Sprint 14 → 298 incluindo as 37 novas do Sprint 15 Faixa A: 16 RLS + 21 workflow engine).

**Adiado Sprint 15b (sprint futuro, ainda não aberto):**

OCR de boleto multi-provider (ADR 0035), inbox NF-e unificada `nfe_received`/`nfe_returns` (ADRs 0056/0058), manifestação destinatário NF-e (ADR 0057), self-issued NF-e entrada (ADR 0060), retenções tributárias `tax_natures`/`tax_retentions` (ADR 0061), `fiscal_emissions`/`fiscal_events` preparação (ADR 0059), parser FEBRABAN linha digitável, parser XML NF-e, UI `/app/financeiro/nfe` inbox unificada, UI `/app/settings/financeiro/ocr` + `/naturezas` + `/aprovacao`, handler boleto-upload WhatsApp inbound (Sprint 13 hub), feature flag `erp_financeiro_v1` (PostHog dropado MVP), E2E completo (OCR→AP→aprovação→pagamento; XML→fornecedor→AP), RIPD erp-financeiro, lint `cross-tenant-read-must-log` em queries de doc_key NF-e. Schemas AP/AR pré-cabeados (`taxNatureId/retentionTotalCents/netAmountCents/nfeReceivedId/noInvoice/source`) — Faixa B/C/D de 15b não exigem nova migration.

**Pendências menores adiadas Sprint 15+ próximo PR:**

- UI `/app/settings/financeiro/aprovacao` (editor visual de `approval_rules`) — backend Server Actions já prontos; UI fica pendente
- Pagamento via Asaas (`payViaAsaas`) reusando wrapper Sprint 04
- Pagamento em lote (gerente seleciona N APs approved e paga de uma vez)
- Escalada por timeout em AP pending_approval (job cron + Sprint 13 régua dispara reminder)
- Detecção de ciclo via recursive CTE em `moveChartAccount` (improvável na UI, mas robustez)
- Widget "Contas a pagar vencendo" no dashboard gerente (Sprint 07 estendido)
- Permission gates `financeiro.ap.read/write`/`financeiro.approve`/`financeiro.pay` enforcement em Server Actions (atualmente confia em RLS tenant-scoped + workflow `canUserApprove`)
- Search index sync para `accounts_payable`/`accounts_receivable`/`suppliers` (ADR 0062, regra 30)
- Particionamento `accounts_payable` por mês quando volume justificar (regra 34 + ADR 0072)
- Anexar PDF NF/boleto via MinIO (`attachment_storage_path` pré-cabeada; depende de scanUpload regra 38)

## Definition of Done

- [ ] Feature flag `erp_financeiro_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] OCR.space integrado e funcionando em sandbox
- [ ] Parser NF-e valida contra XSD nacional
- [ ] Workflow de aprovação auditado nos 5 cenários canônicos
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 15 → `done`
- [ ] ADRs 0033, 0034, 0035 publicados

## Retro

- —
