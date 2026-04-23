# Sprint 18 — Geral · Adquirência (maquininhas Cielo/Stone/Rede/GetNet/PagSeguro)

- **Área:** geral
- **Início:** planejado (depois do Sprint 17)
- **Fim planejado:** +3 semanas
- **Status:** planejado (fecha bloco ERP Financeiro; último antes de Churn)
- **Item do roadmap:** #20

## Goal

Integração com adquirentes/maquininhas para rastrear vendas físicas (cartão presencial), receber arquivos de vendas/antecipação, conciliar com o financeiro e dar visão unificada de receita (online Asaas + presencial maquininha).

## Critério de aceite

**Integrações (mínimo nas 5 adquirências prioritárias):**
- **Cielo**: API e-Commerce + API Consulta Vendas
- **Stone**: Stone Connect API
- **Rede** (Itaú): API de vendas + antecipação
- **GetNet**: API v2
- **PagSeguro**: API de consulta de vendas

Cada integração abstraída por interface comum.

**Funcionalidades:**
- Cadastro de `acquirer_connections` por company — credenciais criptografadas
- Sincronização diária de vendas: `acquirer_sales` com detalhes (bandeira, tipo cartão, parcelas, taxas, valor líquido, data captura, data prevista crédito)
- Conciliação automática com extratos bancários (Sprint 17): venda cai na conta como "Stone R$ X" → concilia
- Antecipação: interface para solicitar antecipação de recebíveis via API quando disponível; mostra custo (% de desconto)
- Split automático em franquias (com `franchise_agreements` do Sprint 01b): venda numa unit da franqueada credita % na matriz conforme acordo
- Taxas: cálculo do custo real por venda (taxa nominal + tarifa + MDR); DRE segrega receita bruta de líquida
- Alerta de divergência: venda capturada na maquininha mas não apareceu no extrato em D+X (fraude ou erro)
- Teste E2E: mock API Cielo retornando 10 vendas → conciliação com banco → reporta líquido
- Seed: 2 maquininhas (Stone + Cielo) + 20 vendas fake

## Dependências

- Sprint 15 (AP/AR core)
- Sprint 17 (conciliação bancária + bank_transactions)
- Sprint 04 (receita Asaas online — dashboard unifica online + presencial)

## Decisões tomadas / ADRs esperados

- **ADR 0039 (esperado)** — Adquirência: arquitetura de provider abstrato + ordem de implementação (qual integrar primeiro baseado em demanda do primeiro cliente). Começar com **Stone** (API mais madura, documentação melhor) + **Cielo** (maior volume) + fallback manual (upload CSV).
- **Pergunta aberta:** antecipação automática por regra? "Se saldo previsto negativo D+7, antecipe X% das vendas pendentes". Útil, mas exige configuração consciente do cliente (custo financeiro). Começar só manual; automação vira stretch.

## Módulos entregues

- Integração com 5 principais adquirências (adaptador por provider)
- Sincronização diária de vendas
- Conciliação venda maquininha ↔ extrato bancário
- Antecipação de recebíveis
- Split automático em franquias
- Relatórios: taxas reais, margem bruta vs líquida

## Rotas Next.js

- `/app/financeiro/adquirencia` — lista de maquininhas conectadas
- `/app/financeiro/adquirencia/new?provider=stone` — adicionar
- `/app/financeiro/adquirencia/[id]/vendas` — extrato de vendas + filtros
- `/app/financeiro/adquirencia/[id]/antecipacao` — solicitar antecipação
- `/app/financeiro/adquirencia/conciliacao` — match venda × transação bancária
- `/app/financeiro/receita` — dashboard unificado (online Asaas + presencial)

## Server Actions + API Routes

Server Actions:
- `connectAcquirer(provider, credentials)` — cadastra e testa
- `syncAcquirerSales(connectionId, from, to)` — manual trigger
- `requestAnticipation(connectionId, saleIds[])` — solicita antecipação
- `reconcileSale(saleId, bankTransactionId)` — match manual
- `suggestMatches(connectionId)` — sugere automáticos

API Routes:
- `POST /api/jobs/adquirencia/sync-daily` — job Vercel Cron
- `POST /api/adquirencia/webhook/[provider]` — callbacks de cada provider (quando aplicável)

## Schemas Drizzle (esperado)

Em `packages/db/schema/adquirencia.ts`:

- `acquirer_connections` — `id`, `tenant_id`, `company_id`, `provider` enum (`cielo`, `stone`, `rede`, `getnet`, `pagseguro`), `credentials_encrypted jsonb`, `merchant_id text`, `active`, `last_synced_at`, `sandbox bool`
- `acquirer_sales` — `id`, `tenant_id`, `company_id`, `connection_id`, `external_id text unique` (NSU ou equivalente), `captured_at timestamptz`, `gross_amount_cents`, `net_amount_cents`, `fee_cents`, `card_brand text` (visa/master/elo/etc), `card_kind text` (credito/debito/voucher), `installments int`, `expected_settlement_date date`, `actual_settlement_date nullable`, `bank_transaction_id nullable` (linka quando cair), `status` enum (`captured`, `anticipated`, `settled`, `chargeback`, `cancelled`), `raw_payload jsonb`
- `anticipations` — `id`, `tenant_id`, `connection_id`, `sales_ids uuid[]`, `original_amount_cents`, `anticipated_amount_cents`, `fee_cents`, `requested_at`, `credited_at nullable`, `status` enum (`requested`, `approved`, `credited`, `rejected`)
- `acquirer_reconciliation_rules` — similar a reconciliation_rules do Sprint 17 mas pro mundo maquininha

**RLS:** tenant_id + permission + criptografia at-rest credentials.

## Eventos de domínio emitidos

- `acquirer.connected`, `acquirer.disconnected`
- `acquirer_sale.captured`, `acquirer_sale.settled`, `acquirer_sale.chargeback`
- `anticipation.requested`, `anticipation.credited`
- `acquirer.reconciled_with_bank`
- `acquirer.divergence_detected` — venda > X dias sem settle

## Commit (checklist)

- [ ] Schema Drizzle: `acquirer_connections`, `acquirer_sales`, `anticipations`, `acquirer_reconciliation_rules`
- [ ] RLS + audit + criptografia credentials
- [ ] Wrapper em `packages/ai/adquirencia/provider.ts` com interface comum
- [ ] Adapters: `cielo.ts`, `stone.ts`, `rede.ts`, `getnet.ts`, `pagseguro.ts` (começar Stone + Cielo + 1 mock; outros stretch dentro do sprint)
- [ ] Job sync daily
- [ ] Integração com Sprint 17 (bank_transactions): quando `acquirer_sale.actual_settlement_date` chega, procura match em extrato
- [ ] Split franquia: consome `franchise_agreements` do Sprint 01b
- [ ] UI: conectar maquininha (OAuth ou key), ver vendas, solicitar antecipação, conciliar
- [ ] Dashboard "Receita unificada" (online + presencial)
- [ ] Alerta divergência
- [ ] Card no dashboard gerente: "Receita presencial últimos 30d"
- [ ] Seed: 2 conexões + 20 vendas + 3 rules
- [ ] Testes unit: parser de arquivo de vendas (cada provider tem formato), cálculo de taxas, split franquia
- [ ] Testes E2E: sandbox Stone + Cielo
- [ ] Feature flag `adquirencia_v1`
- [ ] ADR 0039 publicado
- [ ] **Fecha bloco ERP Financeiro**

## Stretch

- [ ] Antecipação automática por regra (configurada pelo gerente)
- [ ] Comparador: "qual adquirente tem menor custo pra esse perfil de vendas?"
- [ ] Conciliação preditiva: IA sugere match quando regra determinística não basta
- [ ] Detecção de chargeback e alerta antecipado

## Log

- —

## Definition of Done

- [ ] Feature flag `adquirencia_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] Sandbox Stone e Cielo funcionando com vendas fake
- [ ] Conciliação maquininha ↔ banco com >80% acerto automático
- [ ] RLS + credentials criptografados
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 18 → `done`
- [ ] ADR 0039 publicado

## Retro

- —
