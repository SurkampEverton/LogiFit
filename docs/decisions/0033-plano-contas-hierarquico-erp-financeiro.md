---
slug: plano-contas-hierarquico-erp-financeiro
status: accepted
date: 2026-05-14
---

# ADR 0033 — Plano de contas hierárquico (self-FK + is_leaf) e seed brasileiro simplificado

## Contexto

Sprint 15 entrega o ERP Financeiro Core (AP + AR + plano de contas). Antes
da decisão, o módulo financeiro do MVP (Sprints 04 + 14) usava apenas:

- `invoices` (Sprint 04) com `service_type` por contrato — sem destino contábil
- `cost_categories` (Sprint 14) com `type ∈ {fixed, variable}` — categoria operacional achatada, não plano de contas

Ambos não atendem ao operador financeiro/contador que precisa **classificar
cada lançamento numa estrutura hierárquica de 4 níveis canônica brasileira**:

```
1 Ativo
└── 1.1 Ativo Circulante
    └── 1.1.04 Contas a Receber Clientes
```

Sem plano de contas estruturado:
- DRE Sprint 14 falha em consolidar despesas administrativas vs comerciais vs financeiras
- Sprint 16 (rateio intercompany) precisa de contas distribuíveis canônicas
- Sprint 17 (Open Finance + conciliação) precisa mapear cada lançamento bancário em conta
- Sprint 22 (TISS) precisa receita de convênio separada de mensalidade Asaas
- Sprint 36 (Focus NFe) precisa receita de serviço vs produto

## Decisão

### Tabela `chart_of_accounts` hierárquica self-FK

```sql
CREATE TABLE chart_of_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  code text NOT NULL,          -- '1.1.04' (chave humana ordenável lexicograficamente)
  name text NOT NULL,          -- 'Contas a Receber Clientes'
  kind chart_account_kind NOT NULL, -- ativo|passivo|receita|despesa|custo
  parent_id uuid NULL,         -- self-FK (NULL = raiz)
  is_leaf bool NOT NULL DEFAULT true,
  description text,
  active bool NOT NULL DEFAULT true,
  archived_at timestamptz,
  ...,
  UNIQUE (tenant_id, code)
);
```

**Princípios:**

1. **Raiz por kind** — 5 raízes canônicas (uma por kind ativo/passivo/receita/despesa/custo). Code de raiz é o número simples ('1', '2', '3', '4', '5').
2. **`code text` ordenável** — formato `N.N.NN` (3 níveis). Ordenação alfabética bate com ordem hierárquica. Regex de entrada: `^[0-9]+(\.[0-9]+)*$`.
3. **`is_leaf bool` como gate** — lançamentos AP/AR só podem apontar para folhas. Server Action `createAP`/`createAR` valida via `chart.isLeaf = true AND chart.active = true`. Quando uma conta-folha vira pai (`createChartAccount` com parent_id apontando para ela), o sistema automaticamente seta `is_leaf=false` no pai.
4. **`kind` herda do pai** — Server Action valida que conta-filha tem mesmo kind do pai. Não há mistura `Receita → Despesa`.
5. **Sem detecção de ciclo no MVP** — `moveChartAccount` valida apenas que `newParentId !== accountId` e mesmo `kind`. Ciclo via N hops é prevenido por convenção (UI não mostra ciclo) + verificação recursive CTE adiada para Sprint 15+.
6. **Soft-delete via `archived_at`** — bloqueado se houver filhas ativas OU lançamentos AP/AR vinculados.
7. **Unique `(tenant_id, code)`** — mesmo code em outro tenant coexiste; mesmo tenant rejeita duplicata.

### Seed brasileiro simplificado (~67 contas por tenant)

Arquivo `packages/db/scripts/seed-plano-contas.ts` popula em cada tenant:

- **12 agregadoras** (raízes + subgrupos): `1`, `1.1`, `1.2`, `2`, `2.1`, `2.2`, `2.3`, `3`, `3.1`, `3.2`, `4`, `4.1`, `4.2`, `4.3`, `4.4`, `4.5`, `5`, `5.1`
- **~55 folhas operacionais** adaptadas a academia/clínica fisio/nutri:
  - Ativo: Caixa, Bancos, Aplicações, Contas a Receber, Cartão, Adiantamentos, Estoque, Impostos a Recuperar, Imobilizado (4 tipos), Software, (-) Depreciação
  - Passivo: Fornecedores, Empréstimos curto/longo, Salários e Encargos, Impostos, Cartões, Adiantamentos de Clientes, Capital Social, Lucros Acumulados
  - Receita: Mensalidade Academia, Personal, Aulas Avulsas, Avaliações, Atendimento Fisio, Consultas Nutri, Suplementos, Vestuário, Convênios, Aluguel, Rendimentos, Reembolsos
  - Despesa: Salários CLT + INSS + FGTS + 13º + Pró-labore + Comissões + Benefícios; Aluguel + Condomínio + Energia + Água + Internet + Material + Software + Contábil + Jurídico; Marketing + Material Gráfico + Eventos + Referral; Juros + Tarifas + IOF; Simples + ISS + PIS + COFINS + IRPJ + CSLL
  - Custo: Materiais Descartáveis, Suplementos CMV, Manutenção, Calibração, Uniformes

**Idempotência:** `ON CONFLICT (tenant_id, code) DO NOTHING`. Roda em cada tenant via for-loop. Pass 2 resolve `parent_id` via lookup por `code`.

Comando: `pnpm --filter @repo/db db:seed:plano-contas`.

## Consequências

**Positivas:**
- Operador financeiro entra no app e já tem plano de contas brasileiro funcional (sem precisar configurar)
- DRE Sprint 14 ganha precisão (Despesas Comerciais ≠ Despesas Administrativas ≠ Despesas Financeiras)
- Sprint 16 (intercompany) tem destino contábil canônico pra rateio
- Sprint 17 (Open Finance) tem mapping bancário → conta pronto
- Sprint 22 (TISS) separa Receita Convênio de Receita Mensalidade Asaas
- Cada tenant pode customizar via `/app/financeiro/plano-contas/new` mantendo o seed como base

**Negativas:**
- Migração futura de outro plano (cliente vindo de contabilidade SCI/Domínio) exige mapping manual
- Empresas Lucro Real podem precisar plano mais granular que ~67 contas — `createChartAccount` resolve mas operador precisa entender estrutura
- Ciclo via N hops não validado no MVP (improvável na prática — UI não permite criar)

**Neutras:**
- `is_leaf bool` é redundante com `count(filhos)` mas evita JOIN/aggregate em todo SELECT
- Plano hierárquico via materialização vs recursive CTE: escolhemos materialização (`is_leaf` + `parent_id`) — ler é trivial, mutação é raríssima

## Alternativas consideradas

**Plano de contas via `tree_path text` (ltree-style)** — facilita query "todas as folhas sob 4.X" mas adiciona dependência de `ltree` extension + complica UPDATE quando muda hierarquia. Rejeitado: `parent_id` + `code` lexicograficamente ordenado já cobre os casos do MVP.

**Plano de contas via `nested set model`** (left/right) — query mais rápida para "ancestors", mas UPDATE custa O(N) e dependências do código (Drizzle) complicam. Rejeitado: overkill pra ~67 contas.

**Achatar `chart_of_accounts` em lookup table tipo `cost_categories`** — não cobre receita/ativo/passivo, e ainda assim DRE/intercompany/conciliação exigem grupo hierárquico. Rejeitado.

**Não criar plano de contas no MVP, deixar pra Sprint 16+** — bloqueia Sprint 17 (Open Finance), Sprint 22 (TISS), Sprint 36 (Focus NFe). Rejeitado.

## Status

Accepted (2026-05-14, Sprint 15 Faixa A → C).

## Referências

- [Sprint 15 — ERP Financeiro Core](../sprints/15-geral-erp-financeiro-core.md)
- [ADR 0034](0034-workflow-aprovacao-ap-declarativo.md) — workflow AP que consome `chart_of_accounts`
- [Sprint 14 — DRE](../sprints/14-geral-dre-custos-operacionais.md) — DRE consome chart_of_accounts.kind agrupado
