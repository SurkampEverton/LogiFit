# Sprint 24 — Geral · Estoque (descartáveis + revenda)

- **Área:** geral (começa atendendo Fisio; Academia e Nutri reusam)
- **Início:** planejado (depois do Sprint 23)
- **Fim planejado:** +2 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #22

## Goal

Controle de estoque de materiais consumíveis (gaze, agulha, atadura, descartáveis) e produtos de revenda (cremes, faixas elásticas, suplementos) com entradas, saídas, alertas de mínimo, baixa automática por devolução de compra (ADR 0058) e integração com vendas no balcão (POS simples com emissão fiscal — NFC-e varejo ou NF-e produto via Sprint 36 quando ativo).

## Critério de aceite

- Catálogo `stock_items` por company (ou por unit se operação é por local) com SKU, nome, categoria, custo, preço venda, estoque mínimo
- Entradas por compra (recebimento de nota fiscal) + ajuste de inventário manual
- Saídas por consumo interno (gasto em atendimento) + venda no balcão + ajuste
- Cálculo de saldo em tempo real via soma de movimentações (não mantém contador denormalizado — evita divergência)
- Alerta quando saldo ≤ mínimo (Realtime + email/WhatsApp via régua Sprint 13)
- Método de custo: PEPS (FIFO) ou custo médio — configurável por tenant (ADR 0087)
- POS simples para venda: select item → quantidade → forma pagamento → gera `invoice` no Sprint 04
- Vinculação opcional de consumo a `appointment_id` / `consulta_id` (auditoria)
- Inventário: contagem física com diferença apurada em `stock_movements` tipo `ajuste`
- Relatório de giro + produtos parados
- Teste E2E: cadastrar 5 itens, dar entrada, vender 2, consumir 1, ver saldo correto
- Seed: 10 itens de exemplo + 3 movimentações por item

## Dependências

- Sprint 04 (invoice — venda no balcão cria invoice)
- Sprint 21 (fisio evolução — pode marcar consumo na sessão)

## Decisões tomadas / ADRs esperados

- **ADR 0087 (esperado)** — Método de custo (PEPS vs custo médio) e modelo de saldo (soma de movimentações vs contador denormalizado com trigger). Recomendação: soma + view materializada para performance se necessário. (Numeração ≥0080 conforme [roadmap §convenção fora-de-sprint](../roadmap.md) — 0031 já alocado a Sprint 22 validador TISS proativo.)
- **Pergunta aberta:** multi-depósito — permitir estoque por `unit` ou só por `company`? Começar por `company` (simples); multi-unit é evolução se surgir demanda.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Catálogo de itens de estoque
- Entradas/saídas/ajustes (movimentações)
- Cálculo de saldo em tempo real
- Alerta de mínimo
- POS simples integrado ao financeiro
- Inventário e relatórios

## Rotas Next.js

- `/app/estoque` — dashboard: saldos críticos + giro
- `/app/estoque/itens` — catálogo
- `/app/estoque/itens/[id]` — detalhe + movimentações
- `/app/estoque/entradas` — registrar entrada (compra/ajuste)
- `/app/estoque/saidas` — saída manual (ajuste/perda)
- `/app/estoque/vendas` — POS simples
- `/app/estoque/inventario` — contagem física
- `/app/estoque/relatorios` — giro, parados, conferência

## Server Actions + API Routes

Server Actions em `apps/web/app/estoque/actions.ts`:

- `createStockItem(input)` / `updateStockItem`
- `registerEntry(itemId, quantity, unitCostCents, reference, attachment?)` — attachment = NF-e PDF
- `registerExit(itemId, quantity, reason, appointmentId?, consultaId?)`
- `sellAtPos(items[], memberId?, paymentMethod, fiscalDocKind?)` — cria invoice Sprint 04 + movimentação saída; `fiscalDocKind` opcional (`nfce` varejo sem memberId ou `nfe_product` quando há member identificado); se Sprint 36 ativo, dispara emissão via Focus NFe (ADR 0059); se não, apenas registra venda sem emissão
- `countInventory(countings[])` — lista `{ itemId, physicalQty }`; gera ajustes com diferenças
- `getItemBalance(itemId)` — utilitário read-only

## Schemas Drizzle (esperado)

Em `packages/db/schema/estoque.ts`:

- `stock_items` — `id`, `tenant_id`, `company_id`, `sku text`, `name`, `category text`, `unit text` (un/kg/ml), `cost_cents numeric`, `sale_price_cents nullable`, `min_stock int default 0`, `is_resale bool`, `active`, `archived_at`
- `stock_movements` — `id`, `tenant_id`, `company_id`, `item_id`, `kind` enum (`entry_purchase`, `entry_adjustment`, `exit_consumption`, `exit_sale`, `exit_loss`, `exit_adjustment`, `exit_return_to_supplier`, `entry_return_from_customer`), `quantity numeric` (positivo sempre; `kind` define sinal), `unit_cost_cents nullable`, `reference_doc text nullable` (NF-e, invoice, appointment uuid), `appointment_id nullable`, `consulta_id nullable`, `invoice_id nullable`, `nfe_return_id uuid nullable` fk `nfe_returns` (ADR 0058), `fiscal_emission_id uuid nullable` fk `fiscal_emissions` (ADR 0059), `user_id`, `at timestamptz`, `notes text`
- `stock_inventories` — `id`, `tenant_id`, `company_id`, `counted_at`, `counted_by_user_id`, `status` enum (`draft`, `finalized`), `finalized_at nullable`
- `stock_inventory_entries` — `inventory_id`, `item_id`, `system_qty numeric`, `physical_qty numeric`, `difference numeric`, `notes text`. PK `(inventory_id, item_id)`.

**RLS:** tenant_id + scope; permission `estoque.read`, `estoque.write`, `estoque.sell`.

## Eventos de domínio emitidos

- `stock.item_created` / `stock.item_archived`
- `stock.movement_recorded` — `{ item_id, kind, quantity, at }`
- `stock.low_stock_alert` — quando saldo cruza o mínimo (consumido pela régua Sprint 13)
- `stock.item_sold` — `{ item_id, quantity, invoice_id, member_id? }`
- `stock.inventory_finalized`

## Commit (checklist)

- [ ] Schema Drizzle: `stock_items`, `stock_movements`, `stock_inventories`, `stock_inventory_entries`
- [ ] View `stock_balances` (saldo atual por item, calculado)
- [ ] RLS + audit (regra 5 — registro imutável; ajuste é movimentação nova, nunca DELETE)
- [ ] Zod + Server Actions
- [ ] POS simples em `/app/estoque/vendas` com integração Sprint 04 (gera invoice paid imediatamente ou pending conforme método)
- [ ] Botão "Emitir NFC-e" ou "Emitir NF-e produto" no POS (ativo quando Sprint 36 ativo — ADR 0059); integra com `fiscal_emissions` automaticamente
- [ ] Listener em `nfe_return.emitted` (ADR 0058): gera movimentação `exit_return_to_supplier` baixando do estoque os itens devolvidos com rastro via `nfe_return_id`
- [ ] Listener opcional em devolução de venda recebida (ADR 0060 — `nfe_received.inbound_direction='sales_return'`): gera `entry_return_from_customer` devolvendo ao estoque
- [ ] Job detector de `low_stock` que emite evento quando cruza limite
- [ ] Régua padrão no Sprint 13 atualizada para consumir `stock.low_stock_alert`
- [ ] Widget "estoque crítico" no dashboard do gerente (Sprint 07)
- [ ] Relatórios de giro (entradas / saídas / saldo / tempo médio na prateleira)
- [ ] Vinculação de consumo a consulta/appointment (UI no prontuário Fisio)
- [ ] Seed: 10 itens com movimentações
- [ ] Testes unit do cálculo de saldo + custo PEPS/médio
- [ ] Testes E2E: cadastrar, comprar, vender, inventariar
- [ ] Feature flag `estoque_v1`
- [ ] ADR 0087 publicado

## Stretch

- [ ] Leitor de código de barras (câmera do celular / scanner USB)
- [ ] Requisição interna (profissional pede reposição)
- [ ] Compras automáticas (quando bate mínimo + fornecedor cadastrado, gera ordem)
- [ ] Etiqueta de validade + alerta de vencimento
- [ ] Integração com fornecedor (envia pedido via email/WhatsApp)

## Log

- **2026-05-17 — Faixa A entregue:** 4 schemas (stock_items unique SKU+CHECK / stock_movements APPEND-ONLY @volume 2.4M+/ano + CHECK qty + unit_cost on entry_purchase / stock_inventories + stock_inventory_entries CHECK difference consistente) + RLS + UPDATE bloqueado em movements + 12 RLS tests; migration `0030_wide_slyde.sql`.
- **2026-05-17 — Faixa B.1 entregue:** lib pura inventory.ts (calculateBalance SUM + calculateAverageCostCents média ponderada + calculatePeps FIFO com lotes+cogs+remainingLots + detectLowStockCrossing distinguindo shouldAlert vs crossedDown + calculateInventoryAdjustment) com 23 unit tests.
- **2026-05-17 — Faixa B.2 entregue:** 11 Server Actions wrapped — createItem captura SKU duplicado; registerEntry/registerExit com recálculo custo médio + alert low_stock; sellAtPos MVP sem invoice (Sprint 24b integra AR Sprint 15); getItemBalance + listLowStockItems via SQL agregado; inventory pipeline start→count→finalize gera ajustes.
- **2026-05-17 — Faixa C entregue:** 2 rotas (/estoque hub 5 KPIs com valor estoque + /estoque/itens catálogo com saldos derivados SQL inline + badge low_stock color-coded). Demais rotas placeholders pra Sprint 24b junto com AR/NFC-e.
- **2026-05-17 — Faixa D entregue:** ADR 0087 Proposed; seed-estoque 20 items + 60 movements. **637 tests verdes** (era 602, +35 Sprint 24).
- **Quebra 24a/24b:** sem AR integration + sem NFC-e Focus + sem multi-unit + UI parcial, 24a focou em schema + lib pura + Server Actions core. 24b integra todas as pontas.

## Definition of Done

- [x] Feature flag `estoque_v1` — **adiado Sprint 24b** (sem POS-AR + sem RIPD não pode ir a produção)
- [x] Testes unit (23) + RLS (12) verdes; E2E adiado 24b
- [x] RLS verificada (12 tests incluindo UPDATE rejeitado para append-only)
- [x] Migration `0030_wide_slyde.sql` aplicada
- [x] CHANGELOG atualizado
- [x] Roadmap: sprint 24 → `done (24a core)`
- [x] [ADR 0087](../decisions/0087-estoque-custo-saldo-model.md) publicado **Proposed**

## Retro

- **Acertos:** saldo via SUM ao invés de contador denormalizado simplifica auditoria — todo número derivável das movimentações. Lib pura cobrindo PEPS FIFO com 6 cenários canônicos (lote antigo primeiro / exit > lote / intercalado / fora-de-ordem / sem custo) cobre maioria dos edge cases reais.
- **Decisão controversa:** APPEND-ONLY enforced via "sem policy UPDATE + sem GRANT UPDATE". Correção manual = ajuste pra mais/menos como movement novo, não edit. Aceito pela regra 5 fiscal.
- **Erros:** test UPDATE inicialmente checava errCode='42501', mas Postgres às vezes retorna 0 rows updated silenciosamente quando RLS sem policy. Ajustei pra testar `errCode === '42501' || updateCount === 0`. Lição: RLS sem policy UPDATE pode ser silenciosa.
- **Aprendizados:** `numeric` em Drizzle vem como string. Toda comparação numérica precisa `Number(x)` explícito. SQL inline `signOfKind` via CASE é simples e eficiente — sem precisar View materializada no MVP.
- **POS sem invoice no MVP** — Sprint 04 invoices exige contractId. POS de balcão é avulso. Solução foi gerar só movimentos com posRef; Sprint 24b cria accounts_receivable Sprint 15 com chartAccountId default.
- **Próximo Sprint 25:** ANVISA (equipamentos + manutenção + limpeza) + integração CNES. Sprint regulatório clínico.
