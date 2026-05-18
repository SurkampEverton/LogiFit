---
slug: estoque-custo-saldo-model
status: proposed
date: 2026-05-17
---

# ADR 0087 — Método de custo de estoque (PEPS vs custo médio) + modelo de saldo

## Contexto

Sprint 24 entrega o módulo de estoque (materiais consumíveis + revenda) com POS básico. Decisões fundamentais:

1. **Método de custo** — PEPS (FIFO) vs custo médio vs UEPS (LIFO; vetado pela legislação brasileira)
2. **Modelo de saldo** — soma de movimentações em tempo real vs contador denormalizado com trigger
3. **Configurabilidade** — método por tenant, por company ou por item?
4. **Multi-depósito** — estoque por unit ou só por company?

## Decisão

### 1. Suporte a **PEPS e custo médio** — escolha por item

`stock_items.cost_method` enum `peps` | `custo_medio` (default `custo_medio`). Tenant escolhe na criação; Sprint 24b adiciona `tenant_settings.default_cost_method` (Enterprise) pra padronizar.

**Por quê não UEPS:** Lei 6.404/1976 art. 183 + RFB IN 1.700/2017 vedam UEPS para fins fiscais no Brasil. Não compensa implementar opção sem caso de uso real.

**Por quê suportar ambos PEPS + custo médio:**
- Custo médio é o padrão das pequenas/médias empresas (Simples Nacional + maioria das clínicas/academias)
- PEPS é exigido por algumas operações (perecíveis, lotes com validade) e produz cogs mais preciso em períodos inflacionários
- Mudança de método exige aprovação contábil + auditoria, mas o sistema permite (Sprint 24b adiciona migration log)

**Implementação na lib pura `inventory.ts`:**

```ts
calculateAverageCostCents(movements: Movement[]): number
// soma(qty × custo) / soma(qty) considerando só entries com unitCost

calculatePeps(movements: Movement[]): {
  finalBalance, cogsCents, currentInventoryCostCents, remainingLots[]
}
// Cronológica: cria lotes em entries; consume FIFO em exits
```

### 2. Saldo calculado por **soma de movimentações** (não contador denormalizado)

```sql
balance = SUM(CASE WHEN kind LIKE 'entry_%' THEN quantity ELSE -quantity END)
       FROM stock_movements WHERE item_id = X
```

**Vantagens:**
- Verdade única — sem possibilidade de divergência entre contador e movimentos
- Auditoria total — todo número derivável das movimentações
- Sem trigger complexo — toda mutação é INSERT puro

**Custo:**
- Query pesada quando volume alto (>10k movimentos/item). Mitigação:
  - View materializada `stock_balances` refresh on demand (Sprint 24b) — agora reservado pra alto volume real
  - Indexes em `(tenant_id, item_id, at)` cobrem a maioria
  - Sprint 24b avalia trigger que mantém `stock_items.cached_balance` atualizado se virar gargalo

**Rejeitado:** contador denormalizado com trigger. Motivos:
- Trigger PL/pgSQL aumenta complexity sem necessidade no MVP
- Mismatch entre contador e movements requer reconciliação periódica
- Volume @2.4M/ano é tranquilo pra SUM com índice

### 3. Append-only stock_movements (regra 5)

`stock_movements` é APPEND-ONLY:
- INSERT permitido
- UPDATE bloqueado (sem policy + sem GRANT UPDATE no `logifit_app`)
- DELETE bloqueado (idem)

Ajuste pra mais/menos vira movimento novo (`entry_adjustment` / `exit_adjustment`).

**Por quê:**
- Regra 5 — auditoria fiscal requer histórico imutável (Lei 10.406/2002 + Lei 6.404 + IN RFB 2.110/2022)
- Movimento errado fica registrado, ajustado com novo movimento referenciando-o em `notes`
- Reconciliação contábil sempre tem trilha auditável

### 4. Multi-depósito: **por company no MVP**, multi-unit em Sprint 24b se houver demanda

`stock_items.company_id` + `stock_movements.company_id`. Mesmo SKU pode existir em companies diferentes do tenant (cada filial tem seu estoque).

**Por quê não por unit no MVP:**
- 80% dos tenants têm 1 unit por company; complexidade adicional sem benefício
- Multi-unit precisa de "transferência entre unidades" (novo enum kind), inventário por unit, picking, etc — sprint próprio

**Sprint 24b:** se primeiro tenant cliente real tiver multi-unit, adicionar:
- Nova coluna `unit_id` opcional em ambas tabelas
- Novos kinds: `entry_transfer_in`, `exit_transfer_out`
- View `stock_balances_by_unit`

### 5. Detecção de low_stock por crossing

`detectLowStockCrossing({balanceBefore, balanceAfter, minStock})` distingue:
- `shouldAlert: balanceAfter <= minStock` — saldo atual abaixo do limite
- `crossedDown: balanceBefore > minStock && balanceAfter <= minStock` — acabou de cruzar

`shouldAlert` controla badge UI permanente; `crossedDown` dispara evento `stock.low_stock_alert` UMA vez (não toda movimentação enquanto estiver baixo). Régua Sprint 13 consome o evento (WhatsApp/email).

### 6. POS sem invoice no MVP

`sellAtPos` cria APENAS `stock_movements` com `kind='exit_sale'` + `reference_doc='pos:user:timestamp'`. **Não cria invoice nem accounts_receivable** porque:
- `invoices` (Sprint 04) exige `contractId` — POS sem contrato vinculado quebra
- `accounts_receivable` (Sprint 15) exige `chartAccountId` — operador POS não escolhe plano de contas

**Sprint 24b:**
- Cria `accounts_receivable` automático com `chartAccountId` configurado em `tenant_settings.pos_default_chart_account`
- Integra com Sprint 36 Focus NFe pra emissão NFC-e automática (ADR 0059)
- Co-participação convênio (Sprint 22) também vira AR via mesma pipeline

## Consequências

### Boas
- Saldo é verdade única, sempre derivável de stock_movements
- Append-only protege auditoria contra correção destrutiva
- 2 métodos de custo cobrem 100% dos casos brasileiros
- Multi-company já presente no MVP (multi-unit é evolução)
- Lib pura `inventory.ts` testável (23 unit tests cobrem PEPS + custo médio + low_stock + ajuste)

### Ruins
- POS sem invoice no MVP — tenant precisa registrar AR manualmente até Sprint 24b
- Sem multi-depósito por unit — operações grandes (academia com 5 unidades) precisam workaround (1 company por unit)
- View materializada de saldos diferida — performance MVP depende de indexes
- Custo médio "atualiza ao receber" — mudança retroativa em entry antiga não recalcula entries posteriores (precisa job de reprocessamento Sprint 24b)

### Riscos
- **Estoque negativo** — Server Action `registerExit` NÃO bloqueia saldo negativo por default (operador pode estar tentando registrar consumo pendente). Sprint 24b: feature flag `block_negative_stock` por tenant.
- **PEPS com saldo negativo** — `calculatePeps` consume FIFO até zerar; se exit > total lotes, COGS incompleto. Sprint 24b emite warning quando isso acontece.
- **Reconciliação contábil** — auditor pode querer "trava de mês fechado". Sprint 24b: bloqueio de movements retroativos (`at < tenant_settings.closed_period_end`).

### Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Só PEPS | Maior parte dos clientes usa custo médio; força mudança contábil |
| Só custo médio | Casos com lotes (medicamentos com validade) ficam piores |
| UEPS | Vedado pela legislação BR |
| Saldo denormalizado em `stock_items.balance` | Risco de mismatch + complexity sem ganho real |
| Multi-unit no MVP | Cresce escopo 30%+ sem caso de uso confirmado |
| POS cria invoice automático | invoices Sprint 04 exige contractId → não cabe POS avulso |

## Status

**Proposed.** Promove para **Accepted** quando primeira venda real do POS gerar AR via Sprint 24b + relatório fiscal anual fechar sem divergência.

## Referências

- Sprint 24 [`docs/sprints/24-geral-estoque.md`](../sprints/24-geral-estoque.md)
- [ADR 0072](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) — particionamento stock_movements
- [ADR 0033](0033-plano-contas-hierarquico-erp-financeiro.md) — chartAccountId default pro POS Sprint 24b
- [ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) — NFC-e via Focus NFe Sprint 24b
- Lei 6.404/1976 art. 183 — UEPS vedado
- IN RFB 1.700/2017 — métodos PEPS / custo médio
