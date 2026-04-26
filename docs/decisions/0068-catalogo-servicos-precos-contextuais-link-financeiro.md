# ADR 0068 — Catálogo de serviços + Preços contextuais + Construtor de planos + Link financeiro

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

Durante análise do widget "Plano Premium · bundle" (conversa pré-Sprint 00), identificamos **3 fragmentações** no modelo comercial:

1. **Preço do mesmo serviço mora em 3 lugares diferentes** — `plans.amount_cents` (mensalidade), `bundles.included_services` (créditos), `insurance_procedure_prices` (convênio TISS). Sem fonte única, reajuste de preço obriga editar em múltiplas tabelas.
2. **Admin do tenant não tem UI para montar plano visualmente** — Sprint 04 tem `/app/planos/new` como form simples, sem drag-drop de serviços, sem preview, sem definição de "extras" (o que cobrar quando member excede quantidade incluída).
3. **Link cliente ↔ financeiro fragmentado** — member tem `contracts` (Sprint 04), `invoices` (mensalidade recorrente), `accounts_receivable` (extras avulsos), `appointment_credits` (Sprint 05 saldo), `cashback_ledger` (Sprint 05 stretch), `promotions_applied` — sem view consolidada que conte a história financeira completa.

Decisões do usuário (2026-04-24) sobre este ADR:
1. Construtor de plano = **B** (form com "Adicionar serviço" + modal; sem drag-drop no MVP)
2. Preços contextuais = **A** (tabela única `service_prices` com `context` discriminator)
3. Preview do plano como member veria = **A** (tela dedicada reduz erro de config)
4. Admin cria plano custom por member = **A** (via `service_prices` com `context='member_custom'`)
5. Plus: **link completo cliente ↔ sistema financeiro** — desde criação do contrato até pagamento de extras

## Decision

### Schema — 3 tabelas novas + ajustes

```sql
-- ========================================================================
-- 1. services — catálogo curado pelo tenant
-- ========================================================================
services
  id uuid pk
  tenant_id uuid fk
  company_id uuid nullable        -- null = serviço do tenant inteiro; set = específico de filial
  slug text                        -- 'fisio-sessao-ortopedica','academia-mensalidade'
  name text                        -- "Sessão Fisioterapia Ortopédica"
  description text nullable
  vertical enum ('academia','fisio','nutri','geral')
  kind enum ('recurring','one_time','session','product','package')
  default_duration_min int nullable
  default_price_cents int not null
  requires_professional_role text nullable    -- 'fisio','nutri','personal','instrutor'
  cbo_code text nullable                       -- para TISS Sprint 22
  tuss_code text nullable
  stock_item_id uuid nullable fk stock_items   -- consome do estoque (Sprint 24)
  chart_account_id uuid fk chart_of_accounts   -- receita contábil (Sprint 15)
  tax_nature_id uuid fk tax_natures nullable   -- retenção fiscal padrão (ADR 0061)
  active bool
  archived_at timestamptz nullable
  created_at
  unique (tenant_id, slug)

-- ========================================================================
-- 2. plan_items — composição do plano
-- ========================================================================
plan_items
  id uuid pk
  plan_id uuid fk plans
  service_id uuid fk services
  included_quantity int nullable   -- null = ilimitado; 4 = "4 por ciclo"
  period enum ('per_cycle','total','lifetime') default 'per_cycle'
  extra_price_cents int nullable   -- preço após exceder; null = usa services.default_price
  extra_allowed bool default true  -- hard limit se false
  display_order int default 0      -- ordenação no preview
  unique (plan_id, service_id)

-- ========================================================================
-- 3. service_prices — overrides contextuais (fonte única de preço)
-- ========================================================================
service_prices
  id uuid pk
  service_id uuid fk services
  context enum (
    'default',          -- preço catálogo (1 linha por service, representa services.default_price)
    'plan',             -- incluído ou extra em um plano
    'contract',         -- override para um contrato específico (ex: empresa)
    'member_custom',    -- VIP, funcionário, familiar
    'insurance',        -- negociado com convênio (Sprint 22 migra)
    'promotion',        -- cupom ativo
    'company'           -- preço específico de uma filial
  )
  context_id uuid nullable         -- FK polimórfica conforme context
  price_cents int not null          -- 0 = incluído no plano; >0 = preço especial
  included bool default false       -- true se o preço significa "grátis dentro do plano"
  valid_from date default now()
  valid_until date nullable
  priority int default 100          -- resolução de conflitos (maior = prevalece)
  active bool default true
  created_at
  -- índice parcial: (service_id, context, context_id) WHERE active=true AND (valid_until IS NULL OR valid_until >= current_date)
```

### Ajustes em tabelas existentes

```sql
-- contracts (Sprint 04) ganha rastreabilidade fina
contracts
  ...
  discount_type enum ('none','percent','fixed','free_months') default 'none'
  discount_value numeric nullable       -- % ou centavos ou meses
  discount_reason text nullable
  discount_valid_until date nullable
  referral_code_applied text nullable   -- cupom/promo ativo no contrato

-- invoices (Sprint 04) ganha breakdown
invoices
  ...
  breakdown jsonb                       -- { base, overage_items, discounts, surcharges, taxes_withheld }
  -- ex: { "base": 34900, "overage": [{service:"fisio-extra", qty:1, unit:12000, total:12000}],
  --       "discount": {type:"promo", code:"AMIGO10", amount:3490}, "total":46410 }

-- accounts_receivable (Sprint 15) ganha link ao member
accounts_receivable
  ...
  member_id uuid nullable fk members     -- AR vinculado ao member direto (extras de consumo)
  appointment_id uuid nullable fk         -- AR de sessão extra tem ref ao agendamento
  service_id uuid nullable fk services
  parent_contract_id uuid nullable fk contracts  -- contrato que gerou (não necessariamente billing recorrente)
```

### Resolução contextual de preço

Função pura em `packages/db/services/pricing.ts`:

```ts
async function resolveServicePrice(input: {
  serviceId: string
  memberId: string
  tenantId: string
  date?: Date  // default = now()
  context?: {
    contractId?: string
    insuranceAgreementId?: string
    promotionCode?: string
  }
}): Promise<{
  price_cents: number
  source: 'default' | 'plan_included' | 'plan_extra' | 'contract' | 'member_custom' | 'insurance' | 'promotion' | 'company'
  source_id?: string
  includes_credit: boolean  // true = consumir credit do plano (não cobrar)
  explanation: string
}>
```

**Ordem de resolução** (prioridade decrescente; primeiro match vence):

```
1. insurance     (se member tem plano saúde ativo E appointment tem insurance_agreement_id)
2. member_custom (preço VIP específico deste member)
3. promotion     (cupom ativo aplicável)
4. contract      (override do contrato específico)
5. plan          (incluído ou extra do plano ativo do member)
6. company       (preço específico da filial)
7. default       (preço catálogo)
```

Cada linha aplicada grava `resolution_trace` no audit para disputas futuras.

### 5 telas admin

#### 1. `/app/settings/servicos` — Catálogo (CRUD simples)

- Lista com filtros: vertical, ativo/inativo, busca por nome/slug
- Form de novo serviço: nome, slug (auto), vertical, kind, duração, preço avulso, profissional requerido, CBO/TUSS, estoque vinculado, chart_account
- Botão **"ver onde é usado"** — mostra planos, convênios e contratos que referenciam (evita deletar serviço ativo)
- Arquivar (não deletar — preserva audit)

#### 2. `/app/settings/planos` — Construtor de planos (form + modal)

**Formato decidido: form simples com modal "Adicionar serviço"** (decisão 1B do usuário):

```
┌─ Editar plano "Premium Bundle" ───────────────────────────────┐
│                                                                │
│  Informações                                                   │
│  Nome:       [Premium Bundle________________]                  │
│  Slug:       [premium-bundle_________________]                 │
│  Tipo:       [Recorrente ▾]                                    │
│  Ciclo:      [Mensal ▾]                                        │
│  Preço base: R$ [349,00]                                       │
│  Ativo:      [✓]                                               │
│                                                                │
│  ──────────────────────────────────────────────────────────    │
│  Serviços incluídos          [+ Adicionar serviço]             │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Serviço              Qtd        Extra após exceder      │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ Mensalidade Academia  ∞        ─                [×]     │   │
│  │ Sessão Fisio          4/mês    R$ 120,00        [×]     │   │
│  │ Consulta Nutri        1/mês    R$ 180,00        [×]     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  Preview: [Ver como o member verá]  [Salvar]  [Cancelar]      │
└────────────────────────────────────────────────────────────────┘
```

Modal "Adicionar serviço":
- Select de serviços ativos do catálogo
- Quantidade (null = ilimitado)
- Período (ciclo / total)
- Extra após exceder:
  - Usar preço do catálogo (default)
  - Preço especial R$ __
  - Não permitir (hard limit)

#### 3. `/app/settings/planos/[id]/preview` — Preview member

Renderiza exatamente como o aluno verá em `/meu/planos/[slug]` antes de contratar:

```
  Plano Premium Bundle                    R$ 349,00/mês

  ✓ Academia ilimitada
  ✓ 4 sessões de Fisioterapia/mês
  ✓ 1 Consulta Nutricional/mês

  Extras (quando exceder o incluído):
    Sessão Fisio adicional          R$ 120,00
    Consulta Nutri adicional        R$ 180,00

  [Contratar agora]
```

Admin usa para validar antes de publicar. Reduz erro de configuração.

#### 4. `/app/settings/precos` — Overrides de preço

Visão tabular de todos os `service_prices` com filtros:

```
┌─ Preços contextuais ────────────────────────────────────────┐
│                                       [+ Novo override]     │
│                                                              │
│  Filtros: [Serviço ▾] [Contexto ▾] [Ativo ▾]                │
│                                                              │
│  ┌───────────────────┬──────────────┬────────┬───────────┐  │
│  │ Serviço            │ Contexto     │ Preço  │ Validade  │  │
│  ├───────────────────┼──────────────┼────────┼───────────┤  │
│  │ Sessão Fisio       │ Default      │ R$ 180 │ permanente│  │
│  │ Sessão Fisio       │ Plan Premium │ R$ 0   │ incluído  │  │
│  │ Sessão Fisio       │ Plan Premium │ R$ 120 │ extra     │  │
│  │ Sessão Fisio       │ Conv. Unimed │ R$ 95  │ permanente│  │
│  │ Sessão Fisio       │ Promo OUT26  │ R$ 150 │ 01→31/10  │  │
│  │ Sessão Fisio       │ VIP João S.  │ R$ 140 │ permanente│  │
│  │ Consulta Nutri     │ Default      │ R$ 200 │ permanente│  │
│  └───────────────────┴──────────────┴────────┴───────────┘  │
└──────────────────────────────────────────────────────────────┘
```

#### 5. `/app/settings/promocoes` (Sprint 05 já tinha; formalizar)

CRUD de promoções/cupons. Cada promoção ativa gera linhas em `service_prices` com `context='promotion'` automaticamente.

### Link cliente ↔ financeiro (fluxo completo)

O escopo específico adicionado pelo usuário: **como plano/preço/descontos/valores são linkados ao cliente e controlados pelo financeiro**. Diagrama do ciclo completo:

```
┌─────────────────────────────────────────────────────────────┐
│  1. CONTRATAÇÃO                                              │
│                                                              │
│  Member M compra Plano P via /meu/planos/[slug] ou          │
│  operador em /app/members/[id]/planos                       │
│                                                              │
│  contracts.create({                                          │
│    member_id: M,                                             │
│    plan_id: P,                                               │
│    start_date, end_date,                                     │
│    discount_type, discount_value,                            │
│    referral_code_applied,                                    │
│    cycle: 'monthly'                                          │
│  })                                                          │
│                                                              │
│  → evento contract.created → handler:                        │
│     - cria appointment_credits baseado em plan_items         │
│       (fisio: 4/mês, nutri: 1/mês, academia: ilimitado)      │
│     - cria asaas_subscription recorrente                     │
│     - primeira invoice gerada para o mês corrente (pro-rata) │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  2. CONSUMO                                                  │
│                                                              │
│  Member agenda sessão fisio via /meu/agenda/novo             │
│                                                              │
│  → server action bookAppointment():                          │
│    a) resolveServicePrice({ serviceId, memberId, date })     │
│       retorna: { price: 12000, source: 'plan_extra',         │
│                  includes_credit: false }                    │
│                                                              │
│    b) Se includes_credit=true + saldo>0:                     │
│       - appointments.create(status='confirmed')              │
│       - appointment_credit_ledger(-1, reason='consumed')     │
│       - zero cobrança                                        │
│                                                              │
│    c) Se extra (includes_credit=false):                      │
│       - Mostra modal "Sessão extra R$ 120 — confirmar?"      │
│       - Se confirma:                                         │
│         · appointments.create                                │
│         · accounts_receivable.create(                        │
│             member_id, service_id, appointment_id,           │
│             amount=12000, breakdown={...})                   │
│         · asaas_charge.create(ar_id) → gera PIX/cartão      │
│         · notifica member via push/email                     │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  3. RENOVAÇÃO DO CICLO                                       │
│                                                              │
│  Dia 05 de cada mês (cron job):                              │
│                                                              │
│  → contract.renewed event para cada contrato ativo:          │
│     - asaas gera invoice recorrente (R$ 349)                 │
│     - se cupom de desconto ativo: aplica na invoice          │
│     - se cashback disponível: oferece abater (opt-in)        │
│     - appointment_credits RESETA para o incluído do plano    │
│       (fisio volta para 4, nutri para 1)                     │
│     - cria appointment_credit_ledger(                        │
│         delta=+4, reason='plan_renewal')                     │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  4. PAGAMENTO                                                │
│                                                              │
│  Asaas webhook → POST /api/webhooks/asaas                    │
│                                                              │
│  → handle payment.received:                                  │
│     - invoices.update status='paid' (mensalidade)            │
│     - accounts_receivable.update status='paid' (extra)       │
│     - member.last_payment_at = now()                         │
│     - emite evento payment.received                          │
│     - régua de cobrança cancela lembretes pendentes          │
│     - se member estava bloqueado por inadimplência:          │
│       access_blocks.resolve()                                │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  5. INADIMPLÊNCIA (régua — Sprint 13)                        │
│                                                              │
│  AR ou invoice vencida sem pagamento:                        │
│                                                              │
│  D+0  lembrete suave (email)                                 │
│  D+3  email + WhatsApp                                       │
│  D+7  banner no /meu/* + aviso operador                      │
│  D+14 alerta super_admin + notificação member                │
│  D+21 Academia: access_blocks.create(kind='overdue')         │
│       — QR do aluno para de funcionar                        │
│  D+30 suspensão parcial (cancelar agendamentos futuros)      │
│  D+60 contract.suspended → perde acesso a serviços incluídos │
│  D+90 contract.cancelled (com aviso prévio + LGPD)           │
└─────────────────────────────────────────────────────────────┘
```

### Widget financeiro do member (visão unificada)

#### Operador — `/app/members/[id]` widget `financeiro` (registry Sprint 02)

```
┌─ PLANO & COBRANÇA ──────────────────────────────  Detalhes │
│                                                             │
│  Plano Premium · bundle                                     │
│  R$ 349,00 / mês · cartão 4412 · próx 05/mai                │
│                                                             │
│  ── Consumo do ciclo · abril ──────────────────────        │
│  🏋️  Academia     ilimitada · 54 check-ins                  │
│  💆 Fisio         4 incl · 5 usadas · 1 extra ⚠            │
│  🥗 Nutri         1/mês · 1 usada                           │
│                                                             │
│  ── Últimas cobranças ──────────────────────────────        │
│  ○ 23 abr · em aberto · fisio extra    R$ 120,00 ⚠         │
│  ✓ 05 abr · paga · mensalidade         R$ 349,00            │
│  ✓ 05 mar · paga · mensalidade         R$ 349,00            │
│  ✓ 05 fev · paga · mensalidade         R$ 349,00            │
│                                                             │
│  ── Saldo ──────────────────────────────────────────        │
│  💰 Cashback disponível:  R$ 25,00                          │
│  🎟 Créditos não expirados: 2 aulas premium                 │
│                                                             │
│  Ações:                                                     │
│  [Alterar plano]  [Forçar cobrança]  [Isentar extra]        │
│  [Ver histórico completo]  [Gerar segunda via]              │
└─────────────────────────────────────────────────────────────┘
```

#### Portal paciente — `/meu/financeiro` (Sprint 26)

Mesmo core, ações adaptadas:

```
┌─ SEU PLANO ──────────────────────────────────────────────── │
│                                                             │
│  Plano Premium · bundle                                     │
│  R$ 349,00 / mês · próx 05/mai                              │
│                                                             │
│  Seu uso em abril:                                          │
│  🏋️  Academia — ilimitada                                    │
│  💆 Fisio — 4 incl · 5 usadas · 1 extra (R$ 120)           │
│  🥗 Nutri — 1/mês · 1 usada                                 │
│                                                             │
│  ── Pagar agora ────────────────────────────────────        │
│  ⚠ Você tem R$ 120,00 em aberto (fisio extra, venc. 23 abr)│
│  [Pagar via PIX]  [Pagar com cartão]  [Ver detalhes]        │
│                                                             │
│  ── Seu saldo ──────────────────────────────────────        │
│  💰 Cashback: R$ 25,00 [usar na próxima cobrança]           │
│                                                             │
│  ── Histórico ──────────────────────────────────────        │
│  ✓ 05 abr · R$ 349,00  [baixar recibo]                     │
│  ✓ 05 mar · R$ 349,00  [baixar recibo]                     │
│  ✓ 05 fev · R$ 349,00  [baixar recibo]                     │
│                                                             │
│  [Ver todas]  [Portabilidade de dados (LGPD)]               │
└─────────────────────────────────────────────────────────────┘
```

### Descontos e promoções — como aplicam

**4 mecanismos de desconto integrados:**

| Mecanismo | Onde mora | Quando aplica |
|---|---|---|
| **Cupom / promoção** | `service_prices` `context='promotion'` + `context_id=promotion_id` | Ao contratar (recurring) OU ao cobrar extra — depende do escopo da promoção |
| **Desconto contratual** | `contracts.discount_type/value/valid_until` | Toda cobrança do contrato enquanto válido |
| **Preço VIP member** | `service_prices` `context='member_custom'` + `context_id=member_id` | Automático, sempre que member consome |
| **Cashback acumulado** | `cashback_ledger` (Sprint 05 stretch) | Opcional, member escolhe usar na próxima cobrança |

**Visualização consolidada na invoice:**

```
invoice.breakdown = {
  base: 34900,                        // mensalidade plano
  overage: [
    { service:'fisio-extra', qty:1, unit_price:12000, total:12000 }
  ],
  discounts: [
    { type:'promo', code:'AMIGO10', amount:-3490 },
    { type:'cashback', amount:-2500 }
  ],
  total: 40910                        // 34900 + 12000 - 3490 - 2500
}
```

Renderizado transparente para o member (não apenas "total R$ 409,10" — mostra breakdown).

### Server Actions principais

Em `apps/web/app/financeiro/actions.ts`:

```ts
// Catálogo
createService(input) / updateService / archiveService(id)
listServicesUsage(id)   // onde o serviço é usado (evita apagar ativo)

// Planos
createPlan(input) / updatePlan / archivePlan(id)
addPlanItem(planId, serviceId, qty, period, extraPrice)
removePlanItem(planItemId)

// Preços contextuais
upsertServicePrice({ serviceId, context, contextId, price, validFrom, validUntil })
listServicePrices({ serviceId?, context?, activeOnly? })

// Contratos
createContract({ memberId, planId, discount?, referralCode? })
upgradeContract(contractId, newPlanId)  // com pró-rata
pauseContract(contractId, until, reason)
cancelContract(contractId, reason)

// Resolução de preço (usada pela agenda, POS, convênios)
resolveServicePrice(input) → { price, source, includes_credit, explanation }

// Cobrança extra
bookAppointmentWithPricing(memberId, slotId, serviceId) → { preview, confirmTokenRequired }
confirmExtraCharge(confirmToken) → { ar_id, asaas_charge_id }

// Cashback
applyCashbackToNextInvoice(memberId, amountCents)
```

## Consequences

### Positivas

- **Fonte única de preço** — mudança de valor em 1 lugar propaga para agenda, POS, convênios, bundles, contratos
- **Admin monta plano visualmente** sem SQL ou suporte técnico
- **Preview evita erro** de configuração antes de publicar
- **Preço VIP por member** resolve caso "funcionário da academia paga 50%" sem hack
- **Convênio integra nativamente** (Sprint 22 migra `insurance_procedure_prices` para `service_prices`)
- **Cobrança extra automática** com preview + confirmação — UX smooth sem fricção
- **Widget financeiro consolidado** mostra história completa (plano + consumo + extras + saldo + cashback)
- **Breakdown da invoice transparente** — member vê desconto e extra detalhados (previne dispute)
- **Regra de desconto escalonável** — promoção, VIP, cashback, contratual coexistem sem conflito

### Negativas (mitigáveis)

- **Complexidade da resolução de preço** — função `resolveServicePrice` tem 7 níveis de prioridade; testes unit extensos (20+ cenários) + documentação no código
- **Migration pesada em Sprint 22** — `insurance_procedure_prices` vira `service_prices` com `context='insurance'`; script de data migration necessário (tem zero dado produção no MVP; trivial)
- **Cache de preços em alta concorrência** — member agendando fisio não pode pagar `service_prices` query toda vez; cache 5min por `(service_id, member_id)` mitigação; invalidação em evento `service_prices.updated`
- **Schema cresce ~30%** — 3 tabelas novas + colunas em 3 existentes; justificado pela fragmentação anterior
- **Admin pode criar plano inválido** (incluir serviço de vertical não ativa no tenant) — validador Zod no save

### Riscos não endereçados

- **Tenant grande com 10k members × 100 services × múltiplos contextos** — `service_prices` pode chegar a 1M linhas; índices parciais + particionamento por `tenant_id` resolvem quando passar de 500k
- **Admin deletar serviço em uso** — soft delete (`archived_at`) + validação "onde é usado" + CI bloqueia hard delete em migration
- **Priority conflict** — 2 overrides do mesmo contexto; resolvemos por `priority` DESC + `created_at` DESC tiebreaker

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Preço dentro de cada tabela especializada (plans, bundles, insurance_procedure_prices, etc.) | Fragmentação atual; reajuste de preço em 4 lugares; decisão 2A do usuário é tabela única |
| Drag-drop no construtor de plano | Decisão 1B do usuário — form com modal é mais rápido de entregar e menos bugs |
| Sem preview member | Decisão 3A do usuário — reduz erros; trivial de implementar |
| Preço do plano hard-coded no contrato (sem plano referência) | Perde a capacidade de ajustar preço do plano inteiro em 1 lugar |
| Cashback como promoção única | Cashback é saldo acumulável; não é desconto percentual; tabela separada mantida (Sprint 05 stretch) |
| Sem discount_type no contrato | Desconto negociado (empresa corporativa 20% off por 1 ano) precisa campo; caso real |
| resolveServicePrice no client | Lógica de preço fica server-only (RLS + audit); client só lê resposta |

## Escopo de impacto

**Novo ADR:** este (0068).

**Sprints ajustados:**

- **Sprint 04 Financeiro** — entrega `plan_items` + ajustes em `contracts` (discount_type/value) + `invoices.breakdown` + Server Actions de plano + régua de cobrança integra com AR/invoice. Widget financeiro em `/app/members/[id]` ganha consumo + saldo + histórico.
- **Sprint 05 Ofertas** — entrega `services` + `service_prices` + 5 telas admin + construtor visual de plano + preview member + migração do conceito de bundle para plan+plan_items (bundle vira tipo `kind='bundle'` em `plans`)
- **Sprint 15 ERP Financeiro** — `accounts_receivable` ganha `member_id`, `service_id`, `appointment_id`, `parent_contract_id`; `service_id.chart_account_id` integra com plano de contas automaticamente
- **Sprint 22 Convênios** — `insurance_procedure_prices` MIGRADO para `service_prices` com `context='insurance'`; data migration em seed; UI `/app/fisio/convenios/[id]/precos` vira lista filtrada de `service_prices`
- **Sprint 24 Estoque / POS** — venda no POS consulta `services` (kind='product' vinculado a stock_item) + `resolveServicePrice`; gera AR automático se não pago à vista
- **Sprint 02 CRM** — widget `financeiro` no dashboard do member usa breakdown + saldo + histórico unificado
- **Sprint 26 Portal Paciente** — `/meu/financeiro` espelha widget com ações adaptadas (pagar AR, usar cashback, baixar recibo, portabilidade LGPD)
- **Sprint 13 Régua Cobrança** — consome eventos `invoice.overdue` e `ar.overdue` (AR também entra na régua)

**Docs:**

- `docs/modulos.md` — módulos "Catálogo de serviços" + "Construtor de planos" + "Preços contextuais" em Geral
- `CHANGELOG.md` — entrada consolidada
- `CLAUDE.md` — nota sobre `resolveServicePrice()` como função canônica

## Related

- Reforça [ADR 0020 esperado — Bundles](../sprints/05-geral-ofertas-comerciais.md) — bundle vira `plan` com `kind='bundle'`
- Reforça [ADR 0010 — Financeiro topology](0010-financial-mode-centralized-usa-1-matriz-n-units.md) — service_prices respeita `company_id`
- Integra com [ADR 0029 esperado — TISS](../sprints/22-fisio-tiss-tuss-convenios.md) — `insurance_procedure_prices` migra
- Integra com [ADR 0061 — Motor de retenções](0061-motor-retencoes-e-cobertura-fiscal-faseada.md) — `services.tax_nature_id` default
- Integra com [ADR 0059 — Emissão fiscal](0059-ciclo-fiscal-emissao-focus-nfe.md) — `services.chart_account_id` + `cbo_code`/`tuss_code` usados na emissão NFS-e/NF-e
- Integra com [ADR 0066 — Plano comercial](0066-plano-comercial-pricing-trial.md) — LogiFit também tem seus próprios `services` (os planos Starter/Pro/Business/Enterprise são services do tenant root LogiFit)
- Fontes: experiência SaaS Asaas, Stripe Subscriptions, Recurly pricing model, benchmarks Tecnofit, iClinic
