# Sprint 15 — Geral · ERP Financeiro Core (AP + AR + Plano de Contas + OCR boleto + NF-e XML)

- **Área:** geral
- **Início:** planejado (depois do Sprint 14)
- **Fim planejado:** +4 semanas
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

**OCR de boleto (provider abstrato):**
- Upload por drag-and-drop, câmera PWA ou WhatsApp inbound (stretch)
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

**NF-e entrada (upload manual XML):**
- Upload do XML recebido
- Parser extrai: emitente (vira/atualiza supplier), valor total, itens (para integração futura com estoque Sprint 24), datas
- Cria AP em `draft` linkado ao fornecedor
- Valida chave de acesso (44 dígitos) — duplicatas bloqueadas
- Automação SEFAZ automática vai no Sprint 17

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
- `/app/financeiro/nf-e/upload` — upload XML NF-e
- `/app/financeiro/contas-receber` — AR avulso (não-contrato)
- `/app/financeiro/aging` — aging report
- `/app/settings/financeiro/aprovacao` — configurar regras de workflow
- `/app/settings/financeiro/ocr` — **admin do tenant configura provider OCR**: escolhe na lista (OCR.space/Google Vision/AWS Textract/Azure/Tesseract), cola API key, define provider de fallback, testa com boleto de exemplo e vê preview do resultado

## Server Actions + API Routes

Server Actions:
- `createChartAccount`, `moveChartAccount(id, newParentId)`
- `createSupplier`, `updateSupplier`
- `createAP(input)` (draft), `submitForApproval(apId)`, `approveAP(apId)`, `rejectAP(apId, reason)`
- `registerManualPayment(apId, method, paidAt, reference)`, `payViaAsaas(apId)`
- `createAR(input)`, `generateBoletoAR(arId)`
- `processOcrBoleto(fileUpload)` — chama OCR.space, parseia linha digitável, retorna dados para preencher AP
- `parseNfeXml(xmlContent)` — extrai dados, cria/atualiza supplier, cria AP draft

API Routes:
- `POST /api/financeiro/ocr/boleto` — recebe arquivo, chama OCR.space, retorna JSON estruturado
- `POST /api/financeiro/nfe/upload` — recebe XML, parseia, cria AP

## Schemas Drizzle (esperado)

Em `packages/db/schema/erp-financeiro.ts`:

- `chart_of_accounts` — `id`, `tenant_id`, `code text`, `name text`, `kind` enum (`ativo`, `passivo`, `receita`, `despesa`, `custo`), `parent_id uuid nullable`, `is_leaf bool`, `active`
- `suppliers` — `id`, `tenant_id`, `company_id nullable`, `kind` enum (`pf`, `pj`), `document text` (CPF/CNPJ, unique global), `legal_name`, `trade_name nullable`, `email nullable`, `phone nullable`, `address jsonb`, `default_payment_method text nullable`, `default_payment_term_days int nullable`, `archived_at`
- `approval_rules` — `id`, `tenant_id`, `scope` enum (`ap`, `ar`, `both`), `min_amount_cents`, `max_amount_cents nullable`, `required_approvers jsonb` (array ordenada de roles ou user_ids), `company_id nullable` (regras específicas por empresa), `active`
- `accounts_payable` — `id`, `tenant_id`, `company_id`, `supplier_id nullable`, `chart_account_id`, `amount_cents`, `issue_date`, `due_date`, `description`, `doc_number text nullable` (NF/boleto), `doc_key text nullable` (chave NF-e 44 dígitos, unique), `status` enum (`draft`, `pending_approval`, `approved`, `rejected`, `scheduled`, `paid`, `cancelled`, `reconciled`), `approval_trace jsonb` (array de aprovações com user_id, decision, at, comment), `paid_at nullable`, `paid_amount_cents nullable`, `payment_method text nullable`, `asaas_transfer_id nullable`, `attachment_storage_path nullable`, `source` enum (`manual`, `ocr_boleto`, `nfe_upload`, `nfe_sefaz`), `source_metadata jsonb`, `created_by_user_id`, `created_at`
- `accounts_receivable` — similar a AP mas pro lado recebimento; opcionalmente vinculada a `invoices` (contratos) ou independente
- `ap_ar_payments` — pagamentos individuais (uma AP pode ter múltiplos pagamentos parciais)

**RLS:** tenant_id + scope por company + permission. Chave NF-e unique global para evitar duplicata entre tenants.

## Eventos de domínio emitidos

- `ap.created`, `ap.submitted`, `ap.approved`, `ap.rejected`, `ap.paid`, `ap.reconciled`
- `ar.created`, `ar.boleto_issued`, `ar.received`
- `supplier.created`, `supplier.updated`
- `ocr.boleto_processed` (com accuracy)
- `nfe.received_via_upload`
- `chart_account.created`

## Commit (checklist)

- [ ] Schema Drizzle: `chart_of_accounts`, `suppliers`, `approval_rules`, `accounts_payable`, `accounts_receivable`, `ap_ar_payments`
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
- [ ] UI upload XML NF-e
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
