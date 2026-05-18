---
slug: plano-contrato-cobranca-entidades-separadas
status: accepted
date: 2026-05-13
---

# ADR 0013 — Plano + Contrato + Cobrança como 3 entidades separadas

## Contexto

Sprint 04 entrega o módulo Financeiro Asaas. Existe a tentação de colapsar
"assinatura" numa única tabela (`subscriptions`) com `member_id` + `plan_id` +
status, e gerar cobranças como linhas filhas. Tipo Stripe/Asaas próprios.

Modelo LogiFit precisa:

1. **Plano** com vigência independente de contratos (alterar preço do plano
   amanhã não pode alterar valor de contratos vigentes — preço congelado por
   contrato).
2. **Contrato** vinculando 1 member a 1 plano com janela temporal própria
   (started_at, ends_at). Histórico permanece após cancelamento.
3. **Cobrança (invoice)** com vigência própria, status próprio (pending →
   paid|overdue|cancelled|refunded), múltiplas por contrato (mensal,
   trimestral), com breakdown jsonb auditável.
4. **Pagamento (payment)** confirmando uma cobrança específica via Asaas.
   1:N — recobrança parcial após chargeback pode gerar 2º payment do
   mesmo invoice.

## Decisão

Adotar 4 tabelas separadas (`plans`, `contracts`, `invoices`, `payments`)
em vez de tabela única `subscriptions`. Cada entidade tem vigência + status
+ histórico próprios.

### Modelo

```
plans (catálogo, mutável dentro do tenant)
  └── contracts (member ↔ plan, vigência, status active/paused/cancelled/expired)
        └── invoices (1 ou N por contract, status pending → paid/overdue/cancelled/refunded)
              └── payments (1 ou N por invoice — re-payment após chargeback)
```

### Por que separar `contracts` de `plans`

- **Preço congelado por contrato**: contracts.plan_id é FK mas o valor cobrado
  vem de `invoices.amount_cents` (snapshot). Alterar `plans.price_cents` afeta
  novos contratos; vigentes continuam no preço antigo.
- **Pausa de contrato (trancamento academia)**: tracking via
  `contracts.pause_starts_at` + `pause_ends_at` + `auto_pause_rule jsonb`. Plan
  não muda; só contrato pausa.
- **Múltiplos contratos por member** (raro mas existe): rede com 2 unidades, 2
  planos simultâneos no mesmo member — feasible se schema permitir.

### Por que separar `invoices` de `contracts`

- **Histórico fiscal**: cada cobrança gera evento fiscal próprio (NFS-e Sprint 36
  pode emitir por invoice). Cancelled invoice continua existindo pra auditoria.
- **Breakdown jsonb** ([ADR 0068](0068-catalogo-servicos-precos-contextuais-link-financeiro.md)):
  `{base, overage_items, discounts, surcharges, taxes_withheld}` permite
  transparência total no display ("quanto cada item somou").
- **Múltiplas cobranças por contrato**: contrato mensal gera 12 invoices/ano;
  cobrança avulsa (fora do ciclo) gera invoice extra.

### Por que separar `payments` de `invoices`

- **1:N**: chargeback parcial = invoice continua `paid` mas payment original
  vira `refunded` + novo payment do reembolso.
- **Audit fiscal**: `payment.raw_payload jsonb` guarda exatamente o que Asaas
  enviou — auditoria forense se houver disputa.
- **Métodos múltiplos**: invoice em aberto pode receber boleto E pix complementar
  no futuro (Sprint 04+ feature). Cada método = payment próprio.

## Alternativas consideradas

### A. Tabela única `subscriptions`

```
subscriptions (id, member_id, plan_id, status, started_at, current_invoice_id, ...)
```

- ❌ Pausa: precisa coluna `paused_at`, `pause_reason` — sujeira no schema
- ❌ Preço congelado: precisa snapshot inline (`price_at_subscription`) — duplicação
- ❌ Histórico cancelado: linha vira `status='cancelled'` mas perde clareza:
  contrato + cobrança vivem em mesma row
- ❌ Múltiplos contratos por member: 2 rows com mesmo `member_id` sem clareza
  semântica (são contratos diferentes mesmo)

### B. Stripe-style `subscriptions` + `invoices`

```
subscriptions (id, member, plan, status, started)
  └── invoices (id, subscription_id, amount, status)
        └── payments?  (não — Stripe pulsava 1 payment por charge no subscription)
```

- ✅ Mais simples
- ❌ Não tem `contracts` separados — `subscription` é meio-termo entre `plan`
  (catálogo) e `contract` (vigência). Em LogiFit isso fica confuso porque
  precisamos da distinção pra trancamento + audit.

### C. Modelo LogiFit (escolhido) — 4 tabelas

```
plans
contracts (FK plan, vigência própria)
invoices (FK contract, breakdown jsonb)
payments (FK invoice, audit jsonb)
```

- ✅ Cada entidade tem responsabilidade clara
- ✅ Histórico completo preservado
- ✅ Breakdown jsonb permite UX transparente
- ❌ 4 JOINs pra montar um "perfil financeiro" do member — mitigado por view
  agregada `member_financial_summary` (Sprint 04 Faixa C)

## Consequências

### Positivas

- **Audit trail completo**: nada deleta, tudo cancela. Status enum + timestamps
  preservam linha do tempo
- **LGPD-friendly**: Sprint 26 portal `/meu/privacidade` pode mostrar histórico
  financeiro completo sem joins exóticos
- **NFS-e (Sprint 36) emite por invoice**: 1 nota fiscal por invoice paga, não
  por subscription mensal — granularidade certa pro Focus NFe
- **Trancamento academia limpo**: `contracts.pause_starts_at/ends_at` +
  `auto_pause_rule jsonb` para "auto-pausar após 30d sem check-in" (Sprint 09)
- **Múltiplos métodos por invoice**: boleto + pix complementar = 2 payments na
  mesma invoice (Sprint 04+)
- **Re-cobrança parcial após chargeback**: payment 1 `refunded`, payment 2
  `paid` parcial — invoice continua `paid` (status final)

### Negativas

- **4 tabelas** pra modelar 1 conceito que muitos developers tratam como 1
  → curva de aprendizado time
- **JOINs em UI**: widget financeiro do member faz 3 JOINs (member → contracts
  → invoices → payments). Mitigação: view agregada `member_financial_summary`
  (Sprint 04 Faixa C); cache 30s Redis Sprint 05+ se virar pain
- **Constraints cross-entidade**: invariantes tipo "invoice só pode ter
  amount_cents != soma de payments se houver desconto pós-emissão" precisam
  trigger ou validação aplicação. MVP: aceita drift e log de inconsistência

## Migração futura

Se modelo provar excesso de complexidade pré-traction:
1. Criar view materializada `subscriptions_view` que agrega `contracts.status` +
   `latest_invoice.status` em 1 row por member
2. UI consome view; aplicação continua escrevendo nas 4 tabelas separadas
3. Reverter pra schema único é destrutivo — não retornar

## Referências

- [Sprint 04 — Geral · Financeiro Asaas](../sprints/04-geral-financeiro-asaas.md)
- [ADR 0014 — Chaves Asaas por company vs tenant](0014-asaas-keys-distributed-vs-centralized.md)
- [ADR 0068 — Plano composto por serviços + breakdown](0068-catalogo-servicos-precos-contextuais-link-financeiro.md)
- [ADR 0010 — financial_mode centralized/distributed](0010-financial-mode-centralized-usa-1-matriz-n-units.md)
