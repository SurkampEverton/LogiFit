---
slug: rateio-intercompany-dsl-declarativo
status: accepted
date: 2026-05-15
---

# ADR 0036 — Rateio (`allocation_rules`) + Intercompany (`intercompany_entries`) com DSL declarativa

## Contexto

Sprint 16 entrega 2 features financeiras correlatas:

1. **Rateio entre filiais** — uma conta paga por uma company precisa ter o custo distribuído a N companies (ex: aluguel R$ 10.000 da matriz é "consumido" por 3 filiais que pagaram operacionalmente 40/30/30%). Sem rateio:
   - DRE de cada filial não reflete o consumo real (matriz absorve tudo)
   - Análise de lucratividade por unidade fica enviesada
   - Conciliação cross-company exige planilhas paralelas
2. **Intercompany (IC)** — lançamento contábil cruzando 2 companies da mesma rede (matriz paga fornecedor pela filial; filial 1 presta serviço pra filial 2). Saldo IC precisa ser visível, conciliável e eventualmente liquidado (transferência bancária ou ajuste virtual).

Ambos exigem CNPJs distintos sob o mesmo tenant — só faz sentido em **topology=owned** (rede própria). Em **franchise**, cada CNPJ é dono distinto, e o vínculo entre eles é comercial (contrato franqueado-franqueador), não corporativo. Regra 25 já existente proíbe dado fiscal cruzando companies em franchise.

Sem decisão, o caminho default seria:
- Tabela `ap_splits` simples com `[{company_id, percent}]` hardcoded por AP — não reusável; sem rateio dinâmico
- Lançamentos IC ad-hoc misturados em `accounts_payable` com `tag='intercompany'` — perde tipagem, perde saldo consolidado, NF-e de transferência fica invisível

## Decisão

### Rateio via `allocation_rules` + `ap_allocations`

**`allocation_rules`** — DSL declarativa por tenant; admin desenha regra reusável.

```sql
CREATE TABLE allocation_rules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  kind allocation_rule_kind NOT NULL,
  distribution jsonb NOT NULL,
  description text,
  active bool NOT NULL DEFAULT true,
  archived_at timestamptz,
  ...,
  UNIQUE (tenant_id, name)
);
```

**6 kinds suportados:**

| Kind | distribution | Snapshot dinâmico? |
|---|---|---|
| `fixed` | `[{companyId, percent}]` (soma=100) | não |
| `custom` | idem fixed (alias semântico) | não |
| `proportional` | `[{companyId, weight}]` | não (weights estáticos) |
| `per_unit` | `[{companyId}]` | sim — count de `units` |
| `by_revenue` | `[{companyId}]` | sim — soma invoices.paid mês anterior |
| `by_headcount` | `[{companyId}]` | sim — count de `users` |

**Snapshot frozen no momento do lançamento.** Quando `applyAllocation(apId, ruleId)` é chamada, calculator `distribute()` resolve o contexto **agora** (revenue/headcount/units do instante), grava em `ap_allocations.context_snapshot jsonb` e em `ap_allocations.percent_applied numeric(7,4)`. Mesmo que o KPI mude depois, o rateio permanece. Sprint 16+ pode adicionar recálculo opcional.

**`ap_allocations`** — entries gerados:

```sql
CREATE TABLE ap_allocations (
  ap_id uuid NOT NULL,
  company_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  amount_cents bigint NOT NULL,
  percent_applied numeric(7,4) NOT NULL,
  rule_id uuid,
  rule_kind allocation_rule_kind,
  context_snapshot jsonb,
  ...,
  PRIMARY KEY (ap_id, company_id),
  CHECK (amount_cents > 0),
  CHECK (percent_applied BETWEEN 0 AND 100)
);
```

Append-only via ausência de UPDATE/DELETE policy. Correção via cancelar AP-pai e recriar.

**Calculator pure** em `packages/db/src/rateio/calc.ts`:

```typescript
distribute({ amountCents, rule, context? }): {
  allocations: [{ companyId, amountCents, percentApplied }],
  contextSnapshot
}
```

Garantia de soma exata: rounding distribui o resto para a **última** company da lista (em ordem do distribution). Isso evita perda de centavos — `sum(amountCents) === amountCents` de entrada, sempre.

18 unit tests cobrem: fixed/proportional/per_unit/by_revenue/by_headcount/custom + edge cases (amount=0, 1 cent, weights zero, soma != 100, validation de distribution).

### Intercompany via `intercompany_entries` espelhado

```sql
CREATE TABLE intercompany_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  from_company_id uuid NOT NULL,
  to_company_id uuid NOT NULL,
  amount_cents bigint NOT NULL,
  kind intercompany_kind NOT NULL,  -- payment|transfer|service|goods|adjustment
  reference_ap_id uuid,
  reference_ar_id uuid,
  counter_entry_id uuid,  -- entry espelhada (B→A) ligando o par
  settled_at timestamptz,
  settlement_method text,
  notes text,
  requires_nfe_transfer bool NOT NULL DEFAULT false,
  nfe_transfer_emission_id uuid,  -- Sprint 36 ADR 0059
  ...,
  CHECK (amount_cents > 0),
  CHECK (from_company_id <> to_company_id)
);
```

**5 kinds canônicos:**
- `payment` — matriz pagou fornecedor pela filial
- `transfer` — dinheiro entre contas bancárias do grupo
- `service` — empresa A prestou serviço para B
- `goods` — bens físicos cruzando CNPJs (gatilho NF-e de transferência)
- `adjustment` — ajuste contábil (zera saldo, conciliação)

**Trigger SQL `requires_nfe_transfer`**: quando `kind='goods'` e `from_company.person_id ≠ to_company.person_id` (CNPJs distintos), seta `requires_nfe_transfer=true` automaticamente. UI mostra alerta no dashboard; Sprint 36 (Focus NFe) consome o flag para oferecer botão "Emitir NF-e transferência".

### Regra 25 enforced via trigger PL/pgSQL

```sql
CREATE FUNCTION enforce_owned_topology_for_allocation()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT topology::text FROM tenants WHERE id = NEW.tenant_id) <> 'owned' THEN
    RAISE EXCEPTION 'rateio requer tenant.topology=owned'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Trigger BEFORE INSERT em `allocation_rules` + `intercompany_entries`. Server Action `createAllocationRule`/`createIntercompanyEntry` captura código `23514` e retorna `VALIDATION_ERROR` com mensagem explicativa.

`ap_allocations` herda via AP-pai (não precisa trigger separado — AP-pai já está em tenant owned).

### Liquidação intercompany

`liquidateIntercompany({entryIds[], settlementMethod})`:
- UPDATE batch nas N entries com `settled_at=now()` + `settlement_method ∈ {bank_transfer, virtual, cash, pix, other}`
- Saldos consolidados (view inline em `getIntercompanyBalances` + `generateIcReport`) excluem entries com `settled_at != NULL`
- Liquidação virtual = só registro contábil de fechamento (não move dinheiro real); usada quando saldos contra-direcionais se neutralizam

## Consequências

**Positivas:**
- Rateio é declarativo + reusável; admin desenha rule uma vez e aplica em N APs
- DRE Sprint 14 já consolida por company; `ap_allocations` permite filtrar custos rateados separadamente (Sprint 16+ dimensão `allocation_source`)
- Snapshot frozen evita confusão "o rateio mudou retroativamente"
- IC tipado (`kind` enum) permite tracking diferenciado (goods aciona NF-e, payment não)
- Trigger NF-e remove burden cognitivo do operador — sistema avisa quando regra fiscal aplica
- Regra 25 enforced por SQL — impossível bypassar pela aplicação
- Calculator pure testável (18 tests verdes) + Server Actions wrapped via envelope ADR 0071

**Negativas:**
- Snapshot frozen pode confundir quando rule é mudada mas APs antigas não recalculam — UI Sprint 16+ deve mostrar "Rule original: X; rule atual: Y" se divergir
- `per_unit`/`by_revenue`/`by_headcount` dependem de queries snapshot — operador precisa entender que muda mensalmente
- IC sem espelho automático no MVP — `counter_entry_id` é nullable; operador cria ambas as direções manualmente ou job Sprint 16+ gera contrapartida. Aceitável porque IC nem sempre exige espelho (transferência simples = unilateral).
- NF-e de transferência só dispara em `kind='goods'` — operador pode acidentalmente usar `kind='transfer'` para mover bens. Mitigação: descrição do enum no select da UI deixa claro.

**Neutras:**
- Cap de 20 companies por rule — pragmático; tenant >20 filiais cria múltiplas rules agrupando
- View materializada de balances foi adiada — query inline performa bem até ~10k entries pendentes
- Liquidação batch via array de IDs (vs uma a uma) — UX melhor pra fechamento mensal

## Alternativas consideradas

**`allocation_rules` sem DSL — uma coluna por kind** (`fixed_distribution jsonb` + `dynamic_kpi text`) — desnormaliza; mais fácil de validar mas perde flexibilidade. Rejeitado.

**Rateio inline em `accounts_payable.split_jsonb`** — não reusável; cada AP tem seu split. Operador refaria a mesma distribuição em N APs. Rejeitado.

**Intercompany via `accounts_payable.is_intercompany=true`** — perde tipagem (transfer ≠ goods ≠ service), perde saldo consolidado por par, perde gatilho NF-e. Rejeitado.

**Liquidação via UPDATE em massa sem state machine** — sem audit de quem liquidou + quando. Aceito porque temos `audit_log` via `wrapServerAction` (regra 5) + `notes` append-only que registra `[liquidação] X`. Adequado pro MVP.

**Recálculo retroativo automático** (mudou KPI → recalcula APs antigas) — quebra imutabilidade contábil + auditor não aceita. Rejeitado.

**View materializada `intercompany_balances`** com REFRESH CONCURRENTLY — performance bonus mas adiciona job e complexidade. Rejeitado MVP; query inline performa.

**Sem regra 25** (rateio em franchise) — viola modelo comercial; franqueado é dono distinto. Trigger SQL é o gate certo.

## Status

Accepted (2026-05-15, Sprint 16 Faixa A → D).

## Referências

- [Sprint 16 — Rateio + Intercompany](../sprints/16-geral-rateio-intercompany.md)
- [ADR 0033](0033-plano-contas-hierarquico-erp-financeiro.md) — chart_of_accounts que ap_allocations herdam via AP-pai
- [ADR 0034](0034-workflow-aprovacao-ap-declarativo.md) — workflow AP que precede `applyAllocation`
- [ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) — NF-e transferência (Sprint 36 consome `requires_nfe_transfer`)
- Regra 25 em `docs/rules.md` — clínico não cruza company em franchise; rateio + IC também não
- `packages/db/src/rateio/calc.ts` — calculator puro com 18 unit tests
- `packages/db/src/policies/0035_rateio_ic_rls.sql` — triggers de regra 25 + requires_nfe_transfer
