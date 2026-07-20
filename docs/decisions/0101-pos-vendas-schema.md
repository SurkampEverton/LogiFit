# ADR 0101 — Schema de vendas POS (Sprint 24b — débito de schema do Sprint 24)

- **Status:** Proposed
- **Date:** 2026-07-19
- **Sprint:** 24b (débito descoberto na auditoria do Sprint 36b — ver roadmap "Débitos de schema")

## Context

O Sprint 24 ("POS + revenda") entregou o estoque (`stock_items`/`stock_movements`) mas **nunca criou a tabela de vendas** — o registro da venda de balcão (quem comprou, quais itens, como pagou) não existia. Isso bloqueava:

1. **Emissão NF-e produto e NFC-e** (ADR 0059) — `fiscal_emissions.source_kind='sale'` não tinha fonte; 4 dos 8 tipos de emissão do ciclo fiscal ficavam inalcançáveis.
2. Baixa de estoque por venda com rastreio da origem.
3. Relatório de vendas de revenda (suplemento, acessórios) por período.

Adicionalmente, `stock_items` não tinha **NCM/CEST** — dados obrigatórios por item no layout NF-e/NFC-e.

## Decision

Três tabelas novas em `packages/db/src/schema/pos.ts` + 2 colunas fiscais em `stock_items`:

**`sales`** — cabeçalho da venda de balcão:
- `tenant_id` + RLS (regra 1); `company_id` (emitente fiscal); `unit_id` opcional
- Comprador **opcional** (`member_id` OU `person_id`, ambos null = venda anônima NFC-e; CHECK impede os dois preenchidos)
- `status` enum `sale_status`: `completed` | `cancelled` — POS é venda imediata, sem draft no MVP; cancelamento é soft (`cancelled_at` + `cancel_reason`) e **não** apaga histórico
- `total_cents` (líquido) + `discount_cents`; consistência total = soma(items) − desconto é enforced na Server Action (constraint cross-row não cabe em CHECK)
- `sold_by_user_id` (operador), `sold_at`

**`sale_items`** — itens com **snapshot fiscal no momento da venda**:
- FK `sale_id` (cascade) + `stock_item_id` (restrict)
- Snapshots: `sku`, `description`, `ncm`, `cest_code` — congela o dado fiscal do item mesmo se o cadastro do estoque mudar depois (auditoria da nota emitida)
- `quantity numeric(12,3)`, `unit_cents`, `total_cents`

**`sale_payments`** — formas de pagamento (grupo obrigatório na NFC-e):
- `method` enum `sale_payment_method`: `dinheiro`/`pix`/`credito`/`debito`/`outro` — mapeados pros códigos SEFAZ (01/17/03/04/99) na borda da emissão, nunca armazenados como código
- `amount_cents`; soma = total da venda enforced na SA

**`stock_items`** ganha `ncm text` + `cest_code text` (nullable — item de consumo interno não precisa; emissão fiscal **exige** NCM e falha com erro acionável se ausente).

**Volume (regra 34):** `@volume_estimate_yearly: 200000` por tenant grande — bem abaixo do gate de 5M/ano; sem particionamento. Revisitar se POS de rede franquia ultrapassar.

**Integração fiscal:** `emitNfeProductFromSale(saleId)` e `emitNfceFromSale(saleId)` no módulo fiscal consomem a venda: CFOP via `cfop-resolver` (NFC-e fixo 5102), NCM do snapshot do item, pagamentos mapeados pra `formas_pagamento`. `fiscal_emissions.source_kind='sale'` + `source_id=sale.id`.

**Baixa de estoque:** a SA de criação de venda (Sprint 24b UI, fase 2) grava `stock_movements` com origem na venda; fora do escopo deste ADR.

## Alternatives considered

- **Reusar `stock_movements` como registro de venda** — rejeitado: movimento de estoque não tem comprador, pagamento nem preço de venda; NFC-e exige formas de pagamento.
- **Venda com draft/carrinho persistido** — rejeitado no MVP: POS de academia é fluxo de segundos; draft adiciona estado sem valor. Carrinho vive no client.
- **Guardar código SEFAZ do pagamento direto** — rejeitado: enum semântico no schema, código de tabela externa na borda (mesmo padrão de centavos/basis points do módulo fiscal).

## Consequences

- Desbloqueia NF-e produto, NFC-e e (com `nfe_returns` futuro) devolução — o ciclo fiscal do ADR 0059 volta a ter caminho completo.
- Snapshot fiscal por item aumenta storage (~100 bytes/item) em troca de auditoria correta da nota emitida.
- Fase 2 (Sprint 24b UI): tela POS de venda rápida + baixa de estoque + NFC-e automática no fechamento.
